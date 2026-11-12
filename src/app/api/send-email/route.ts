import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { clientKey, rateLimit, tooManyRequests } from '@/shared/lib/rate-limit';
import { getRequestOrigin } from '@/shared/lib/utils';
import { getFile } from '@/shared/lib/firebase/files';
import type { FileRecord } from '@/types';

// Escape user-supplied text before templating it into the HTML email, so a
// crafted filename or link can't inject markup or attributes.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Most links one email may carry (a multi-file upload sends them together).
const MAX_FILES_PER_EMAIL = 25;

/** Single line, no control characters, capped — safe for the subject header. */
function oneLine(s: string, max: number): string {
  return s.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Share tokens are generateToken(): 16 random bytes as hex.
const SHARE_PATH_RE = /^\/share\/([a-f0-9]{32})$/;
// Encrypted links carry the AES key (URL-safe base64) after the #.
const KEY_FRAGMENT_RE = /^(#[A-Za-z0-9_-]*)?$/;

/**
 * Token and #key of `link` if it is a share page of THIS app:
 * `<our origin>/share/<token>`, no query, optional #key. Anything else is
 * refused, so the endpoint can't mail arbitrary links (phishing relay).
 */
function parseShareLink(link: string, appOrigin: string): { token: string; hash: string } | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.origin !== appOrigin || u.username || u.password || u.search) return null;
  if (!KEY_FRAGMENT_RE.test(u.hash)) return null;
  const token = SHARE_PATH_RE.exec(u.pathname)?.[1];
  return token ? { token, hash: u.hash } : null;
}

/** Still downloadable: exists, not expired, downloads not used up. */
function isAvailable(file: FileRecord | null): file is FileRecord {
  if (!file) return false;
  if (file.expires_at && new Date(file.expires_at).getTime() <= Date.now()) return false;
  if (file.max_downloads !== null && file.download_count >= file.max_downloads) return false;
  return true;
}

/** File name + download button + plain link, all escaped. */
function fileBlockHtml(name: string, link: string): string {
  const nameHtml = escapeHtml(name);
  const linkHtml = escapeHtml(link);
  return `
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">File</p>
              <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #111827; word-break: break-word;">${nameHtml}</p>
              <a href="${linkHtml}" style="display: block; background: #111827; color: white; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 14px; text-align: center; margin-bottom: 10px;">
                Download File
              </a>
              <p style="margin: 0; font-size: 12px; text-align: center; word-break: break-all;">
                <a href="${linkHtml}" style="color: #6b7280;">${linkHtml}</a>
              </p>
            </div>`;
}

export async function POST(request: NextRequest) {
  try {
    // Uses our SMTP account to send mail, so throttle hard: 5 per 10 min per
    // IP. Without this the endpoint is an open relay for spam.
    const rl = rateLimit(`send-email:${clientKey(request)}`, 5, 10 * 60_000);
    if (!rl.allowed) {
      return tooManyRequests('Too many emails sent — try again later.', rl.retryAfterMs);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    const { to } = body;

    // One email can carry every link of a multi-file upload: `files` is
    // [{ name, link }]. The single-file shape { fileName, downloadLink } still works.
    // `name` is ignored — the email shows the name stored with the file.
    const rawFiles: unknown[] = Array.isArray(body.files)
      ? body.files
      : [{ name: body.fileName, link: body.downloadLink }];

    if (typeof to !== 'string' || !to || rawFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    if (rawFiles.length > MAX_FILES_PER_EMAIL) {
      return NextResponse.json(
        { success: false, error: `You can send up to ${MAX_FILES_PER_EMAIL} links in one email` },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Only links to live share pages of this app, so the email can't point
    // anywhere else. The link is rebuilt from our origin + token + #key.
    const appOrigin = new URL(getRequestOrigin(request.headers)).origin;
    const parsed: { token: string; link: string }[] = [];
    for (const raw of rawFiles) {
      const item = raw as { link?: unknown } | null;
      if (!item || typeof item.link !== 'string' || !item.link) {
        return NextResponse.json(
          { success: false, error: 'Missing required fields' },
          { status: 400 }
        );
      }
      const share = parseShareLink(item.link, appOrigin);
      if (!share) {
        return NextResponse.json(
          { success: false, error: 'Only SyncFlow share links from this site can be emailed' },
          { status: 400 }
        );
      }
      parsed.push({ token: share.token, link: `${appOrigin}/share/${share.token}${share.hash}` });
    }

    const records = await Promise.all(parsed.map((p) => getFile(p.token)));
    if (!records.every(isAvailable)) {
      return NextResponse.json(
        { success: false, error: 'One of these files no longer exists or has expired' },
        { status: 400 }
      );
    }
    // Name from Firestore, not the request: capped and stripped of control
    // characters (also keeps the subject header clean).
    const files = parsed.map((p, i) => ({ name: oneLine(records[i].original_name, 200), link: p.link }));
    const isEncrypted = records.some((r) => r.is_encrypted);

    // Optional sender name and note, so the email doesn't read like phishing.
    const senderName = typeof body.senderName === 'string' ? oneLine(body.senderName, 80) : '';
    const message =
      typeof body.message === 'string'
        ? body.message.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[^\P{Cc}\n]/gu, '').trim().slice(0, 1000)
        : '';

    const single = files.length === 1;
    const subject = senderName
      ? single
        ? `${senderName} sent you a file: ${files[0].name}`
        : `${senderName} sent you ${files.length} files`
      : single
      ? `File shared with you: ${files[0].name}`
      : `${files.length} files shared with you`;
    const intro = senderName
      ? `${senderName} sent you ${single ? 'a file' : `${files.length} files`} with SyncFlow.`
      : `You've received ${single ? 'a file' : `${files.length} files`} via SyncFlow.`;
    const senderHtml = escapeHtml(senderName);
    const introHtml = senderName
      ? `<strong>${senderHtml}</strong> sent you ${single ? 'a file' : `${files.length} files`} with SyncFlow.`
      : escapeHtml(intro);

    // Check if SMTP is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json(
        { success: false, error: 'Email service not configured' },
        { status: 500 }
      );
    }

    // Create transporter with Gmail SMTP
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Email content - Minimalist professional design
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #374151; max-width: 520px; margin: 0 auto; padding: 40px 20px; background-color: #f9fafb;">

          <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

            <!-- Logo -->
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #111827;">SyncFlow</h1>
            </div>

            <!-- Main content -->
            <p style="margin: 0 0 24px 0; font-size: 16px; color: #374151;">
              ${introHtml}
            </p>

            ${message ? `
            <!-- Sender's note -->
            <div style="border-left: 3px solid #d1d5db; padding: 4px 0 4px 14px; margin-bottom: 24px;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Message${senderName ? ` from ${senderHtml}` : ''}</p>
              <p style="margin: 0; font-size: 15px; color: #111827; white-space: pre-wrap; word-break: break-word;">${escapeHtml(message)}</p>
            </div>
            ` : ''}

            ${isEncrypted ? `
            <!-- Encryption notice -->
            <div style="background: #f0fdf4; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; border-left: 3px solid #22c55e;">
              <p style="margin: 0; font-size: 13px; color: #166534;">
                <strong>Encrypted</strong> — ${single ? 'This file is' : 'These files are'} end-to-end encrypted. The decryption key is included in the download link.
              </p>
            </div>
            ` : ''}

            ${files.map((f) => fileBlockHtml(f.name, f.link)).join('')}

          </div>

          <!-- Help section -->
          <div style="margin-top: 32px; padding: 0 20px;">
            <p style="margin: 0 0 16px 0; font-size: 13px; color: #6b7280; text-align: center;">
              <strong>Need help?</strong>
            </p>
            <div style="font-size: 12px; color: #9ca3af; text-align: center; line-height: 1.8;">
              <p style="margin: 0;">• Click the download button or copy the link into your browser</p>
              <p style="margin: 0;">• The link may expire after some time</p>
              <p style="margin: 0;">• If the file is encrypted, decryption happens automatically</p>
              <p style="margin: 0;">• Contact the sender if you have any issues</p>
              ${senderName ? '<p style="margin: 0;">• SyncFlow does not verify the sender name. Only open files from people you know.</p>' : ''}
            </div>
          </div>

          <!-- Footer -->
          <p style="margin-top: 32px; font-size: 11px; color: #9ca3af; text-align: center;">
            Sent via <a href="https://sync-flow-steel.vercel.app" style="color: #9ca3af;">SyncFlow</a> — Fast & Secure File Sharing
          </p>

        </body>
      </html>
    `;

    const textContent = `
SyncFlow
========

${intro}

${message ? `MESSAGE${senderName ? ` FROM ${senderName.toUpperCase()}` : ''}
${message}

` : ''}${isEncrypted ? `ENCRYPTED
${single ? 'This file is' : 'These files are'} end-to-end encrypted. The decryption key is included in the download link.

` : ''}${files.map((f) => `FILE: ${f.name}\n${f.link}`).join('\n\n')}

---

NEED HELP?
• Click the download link or copy it into your browser
• The link may expire after some time
• If the file is encrypted, decryption happens automatically
• Contact the sender if you have any issues
${senderName ? '• SyncFlow does not verify the sender name. Only open files from people you know.\n' : ''}
---
Sent via SyncFlow — Fast & Secure File Sharing
    `.trim();

    // Send email
    await transporter.sendMail({
      from: `"SyncFlow" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
