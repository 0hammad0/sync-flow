import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How SyncFlow handles your data — what we store, for how long, and what never leaves your browser.',
};

const LAST_UPDATED = 'June 6, 2026';

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[3rem_1fr] sm:grid-cols-[4.5rem_1fr] gap-3 sm:gap-4 py-6 sm:py-7 border-t border-edge first:border-t-0">
      <span className="font-mono text-xl sm:text-2xl text-fg-faint/60 leading-none pt-1">{n}</span>
      <div className="min-w-0">
        <h2 className="font-display text-lg sm:text-xl font-semibold tracking-tight text-fg mb-2">
          {title}
        </h2>
        <div className="space-y-3 text-sm text-fg-muted leading-relaxed">{children}</div>
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 sm:py-12 animate-fade-in">
      <div className="mb-8 sm:mb-10">
        <p className="label-mono mb-3">Legal</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-fg mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-fg-muted">
          Last updated: <span className="font-mono">{LAST_UPDATED}</span>
        </p>
        <p className="mt-4 text-sm text-fg-muted leading-relaxed">
          SyncFlow is built to know as little about you as possible: no ad trackers, no
          analytics profiles, no selling of data — and content that deletes itself.
        </p>
      </div>

      <div>
        <Section n="01" title="What we collect">
          <p>
            <strong className="text-fg">Files you upload.</strong> Stored so they can be
            downloaded by people you share the link with. If you enable end-to-end encryption,
            we only ever store ciphertext — the decryption key lives in the URL fragment of your
            share link and is never sent to our servers.
          </p>
          <p>
            <strong className="text-fg">File metadata.</strong> File name, size, type, upload
            time, expiry settings, download count, and (for signed-in users) your account ID.
          </p>
          <p>
            <strong className="text-fg">Account data.</strong> If you sign in, your email
            address. Authentication is passwordless — we never store a password.
          </p>
          <p>
            <strong className="text-fg">Chat data.</strong> Messages, attachments, your chosen
            display name, your timezone (for timestamps), and lightweight presence signals
            (online/typing). Chat rooms and everything in them are deleted when the room
            expires.
          </p>
          <p>
            <strong className="text-fg">Email sharing.</strong> If you send a share link by
            email, we use the recipient address once to deliver that email — we don&apos;t store
            it or add it to any list.
          </p>
        </Section>

        <Section n="02" title="What we don't collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>No advertising or cross-site trackers, and no third-party analytics.</li>
            <li>No decryption keys for end-to-end encrypted files.</li>
            <li>No passwords.</li>
            <li>No contact lists, location data, or device fingerprints.</li>
          </ul>
        </Section>

        <Section n="03" title="Cookies & local storage">
          <p>
            We use a single first-party session cookie (<code className="font-mono text-xs">__session</code>,
            httpOnly) to keep you signed in. Your browser&apos;s local storage holds small
            preferences that never leave your device: your theme choice, your chat display name,
            a random device ID used to mark which chat messages are yours, and — briefly — the
            email address used to complete a sign-in link.
          </p>
        </Section>

        <Section n="04" title="How long we keep things">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong className="text-fg">Files:</strong> until their expiry time passes, their
              download limit is reached, or you delete them. Anonymous uploads always expire
              (1 hour to 7 days).
            </li>
            <li>
              <strong className="text-fg">Chat rooms:</strong> deleted automatically when the
              room expires (1 hour to 7 days), including messages and attachments.
            </li>
            <li>
              <strong className="text-fg">Phone-to-PC sessions:</strong> expire after 10 minutes.
            </li>
            <li>
              <strong className="text-fg">Accounts:</strong> until you ask us to delete yours.
            </li>
          </ul>
        </Section>

        <Section n="05" title="Where your data lives">
          <p>
            File contents are stored in Cloudflare R2 (object storage) behind a private bucket —
            downloads happen only through short-lived signed URLs that expire after one hour.
            Metadata, accounts, and chat data are stored in Google Firebase (Firestore and
            Firebase Authentication). Emails are delivered via SMTP. These providers process
            data on our behalf and under their own security commitments.
          </p>
        </Section>

        <Section n="06" title="Security">
          <p>
            All connections use HTTPS. Optional end-to-end encryption uses AES-256-GCM performed
            entirely in your browser via the Web Crypto API. Session cookies are httpOnly and
            secure in production. Storage buckets are private; database writes go only through
            our servers.
          </p>
        </Section>

        <Section n="07" title="Your rights">
          <p>
            You can delete your files at any time from the dashboard, and share links die with
            them. You may request account deletion or a copy of your data by contacting us.
            Depending on where you live (e.g. GDPR or CCPA jurisdictions), you may have
            additional rights of access, correction, deletion, and portability — we honor
            reasonable requests regardless of jurisdiction.
          </p>
        </Section>

        <Section n="08" title="Children">
          <p>
            The Service is not directed at children under 13 (or the minimum age in your
            jurisdiction), and we do not knowingly collect data from them.
          </p>
        </Section>

        <Section n="09" title="Changes & contact">
          <p>
            We may update this policy from time to time; material changes will be reflected in
            the &quot;Last updated&quot; date above. Also see our{' '}
            <Link href="/terms" className="text-brand-text hover:underline font-medium">
              Terms of Service
            </Link>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
