import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: NextRequest) {
  try {
    const { to, fileName, downloadLink, isEncrypted } = await request.json();

    // Validate input
    if (!to || !fileName || !downloadLink) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
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
              You've received a file. Click the button below to download it.
            </p>

            <!-- File info card -->
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">File</p>
              <p style="margin: 0; font-size: 15px; font-weight: 600; color: #111827; word-break: break-word;">${fileName}</p>
            </div>

            ${isEncrypted ? `
            <!-- Encryption notice -->
            <div style="background: #f0fdf4; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; border-left: 3px solid #22c55e;">
              <p style="margin: 0; font-size: 13px; color: #166534;">
                <strong>Encrypted</strong> — This file is end-to-end encrypted. The decryption key is included in the download link.
              </p>
            </div>
            ` : ''}

            <!-- Download button -->
            <a href="${downloadLink}" style="display: block; background: #111827; color: white; text-decoration: none; padding: 14px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; text-align: center; margin-bottom: 24px;">
              Download File
            </a>

            <!-- Link fallback -->
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #9ca3af; text-align: center;">
              Or copy this link:
            </p>
            <p style="margin: 0; font-size: 12px; text-align: center; word-break: break-all;">
              <a href="${downloadLink}" style="color: #6b7280;">${downloadLink}</a>
            </p>

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

You've received a file. Use the link below to download it.

FILE
${fileName}

${isEncrypted ? `ENCRYPTED
This file is end-to-end encrypted. The decryption key is included in the download link.

` : ''}DOWNLOAD LINK
${downloadLink}

---

NEED HELP?
• Click the download link or copy it into your browser
• The link may expire after some time
• If the file is encrypted, decryption happens automatically
• Contact the sender if you have any issues

---
Sent via SyncFlow — Fast & Secure File Sharing
    `.trim();

    // Send email
    await transporter.sendMail({
      from: `"SyncFlow" <${process.env.SMTP_USER}>`,
      to,
      subject: `File shared with you: ${fileName}`,
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
