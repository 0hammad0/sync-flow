import type { Metadata } from 'next';
import { InlineLink, LegalPage, LegalSection } from '@/shared/components/LegalPage';
import { ISSUES_URL } from '@/shared/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How SyncFlow handles your data: what we store, for how long, what is end-to-end encrypted, and what the optional AI features send.',
  alternates: { canonical: '/privacy' },
};

const LAST_UPDATED = 'November 12, 2026';

const SECTIONS = [
  { id: 'collect', title: 'What we collect' },
  { id: 'encryption', title: 'What is and isn’t end-to-end encrypted' },
  { id: 'ai', title: 'AI features' },
  { id: 'not-collected', title: 'What we don’t collect' },
  { id: 'cookies', title: 'Cookies and local storage' },
  { id: 'retention', title: 'How long we keep things' },
  { id: 'storage', title: 'Where your data lives' },
  { id: 'security', title: 'Security' },
  { id: 'rights', title: 'Your rights' },
  { id: 'children', title: 'Children' },
  { id: 'contact', title: 'Changes and contact' },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={LAST_UPDATED}
      sections={SECTIONS}
      intro={
        <p>
          SyncFlow is built to know as little about you as possible: no ad trackers, no analytics
          profiles, no selling of data, and content that expires on the schedule you choose. This
          page explains exactly what we can and can&apos;t see in each tool.
        </p>
      }
    >
      <LegalSection id="collect" title="What we collect">
        <p>
          <strong>Files you share.</strong> Stored so the people you send the link to can
          download them. File shares are end-to-end encrypted by default: we only store
          ciphertext, and the decryption key lives in the part of the share link after the #,
          which is never sent to our servers. If you switch encryption off for an upload, we store
          the file as you uploaded it.
        </p>
        <p>
          <strong>Files sent with Phone → PC.</strong> Stored so the computer that opened the
          session can download them. These transfers are <strong>not</strong> end-to-end
          encrypted.
        </p>
        <p>
          <strong>File metadata.</strong> File name, size, type, upload time, expiry settings,
          download count, and (for signed-in users) your account ID.
        </p>
        <p>
          <strong>Account data.</strong> If you sign in, your email address. Sign-in uses one-time
          email links, so we never store a password.
        </p>
        <p>
          <strong>Chat data.</strong> Messages, attachments, reactions, your chosen display name,
          your timezone (for timestamps), and lightweight presence signals (online and typing).
          Chat rooms and everything in them are deleted when the room expires. Chat is{' '}
          <strong>not</strong> end-to-end encrypted.
        </p>
        <p>
          <strong>Email sharing.</strong> If you send a share link by email, we use the recipient
          address once to deliver that email. We don&apos;t store it or add it to any list.
        </p>
      </LegalSection>

      <LegalSection id="encryption" title="What is and isn’t end-to-end encrypted">
        <ul>
          <li>
            <strong>File shares: end-to-end encrypted by default.</strong> Your browser encrypts
            each file with AES-256-GCM before upload. We can&apos;t read the contents. We can still
            see the metadata listed above.
          </li>
          <li>
            <strong>Phone → PC transfers: not end-to-end encrypted.</strong> Files are encrypted in
            transit (HTTPS) and kept in private storage, but our servers can read them.
          </li>
          <li>
            <strong>Chat messages and chat attachments: not end-to-end encrypted.</strong> They are
            encrypted in transit (HTTPS) and kept in private storage until the room expires, but
            our servers can read them.
          </li>
        </ul>
        <p>
          If you need something to stay unreadable to us, share it as an end-to-end encrypted file
          and send the link.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="AI features">
        <p>
          Chat rooms can offer optional AI features: a catch-me-up summary, smart reply
          suggestions, rewrite, translate and explain code. They are only available when the
          operator of this SyncFlow server has configured them, and they never run on their own.
          Nothing is sent until you click an AI action.
        </p>
        <p>When you do, we send only the text that action needs:</p>
        <ul>
          <li>
            <strong>Catch-me-up summary and smart replies:</strong> recent messages from the room.
          </li>
          <li>
            <strong>Rewrite and translate:</strong> the message you chose, plus your instruction or
            target language.
          </li>
          <li>
            <strong>Explain code:</strong> the code snippet you chose.
          </li>
        </ul>
        <p>
          That text goes to <strong>OpenRouter</strong> (openrouter.ai), which passes it to the
          upstream AI model provider that generates the answer. Both process it under their own
          terms and privacy policies. Files, file shares, the contents of attachments and Phone →
          PC transfers are never sent to AI. AI answers can be wrong; check them before you rely
          on them.
        </p>
      </LegalSection>

      <LegalSection id="not-collected" title="What we don’t collect">
        <ul>
          <li>No advertising or cross-site trackers, and no third-party analytics.</li>
          <li>No decryption keys for end-to-end encrypted files.</li>
          <li>No passwords.</li>
          <li>No contact lists, location data or device fingerprints.</li>
        </ul>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies and local storage">
        <p>
          We use a single first-party session cookie (
          <code className="font-mono text-[13px] text-fg">__session</code>, httpOnly) to keep you
          signed in. Your browser&apos;s local storage holds small preferences that never leave
          your device: your theme choice, a signed-in flag so the page shows the right buttons
          straight away, your chat display name, a random device ID used to mark which chat
          messages are yours, and, briefly, the email address used to complete a sign-in link.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep things">
        <ul>
          <li>
            <strong>File shares:</strong> until the expiry time passes, the download limit is
            reached, or you delete them. Without an account you choose 1 hour, 24 hours or 7 days.
            Signed-in users can also choose 30 days or no expiry; those files stay in My Files
            until deleted.
          </li>
          <li>
            <strong>Phone → PC:</strong> a session stops accepting files after 10 minutes. Files
            received without an account expire after 24 hours; signed-in users keep them in My
            Files until they delete them.
          </li>
          <li>
            <strong>Chat rooms:</strong> deleted automatically when the room expires (1 hour, 24
            hours or 7 days), including messages and attachments.
          </li>
          <li>
            <strong>Accounts:</strong> until you ask us to delete yours.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="storage" title="Where your data lives">
        <p>
          File contents and chat attachments are stored in Cloudflare R2 (object storage) in a
          private bucket. Downloads happen only through short-lived signed URLs. Metadata,
          accounts and chat messages are stored in Google Firebase (Firestore and Firebase
          Authentication). Emails are delivered over SMTP. If AI features are enabled, the text
          you send to them is processed by OpenRouter and the model provider (see{' '}
          <InlineLink href="#ai">AI features</InlineLink>). These providers process data on our
          behalf and under their own security commitments.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          All connections use HTTPS. End-to-end encryption for file shares (on by default) uses
          AES-256-GCM, performed entirely in your browser with the Web Crypto API. Session cookies
          are httpOnly and secure in production. Storage buckets are private, and database writes
          go only through our servers. Phone → PC transfers and chat rooms are protected in
          transit and at rest by our providers, but are not end-to-end encrypted.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your rights">
        <p>
          You can delete your files at any time from My Files, and their share links stop working
          with them. You can ask for your account to be deleted or for a copy of your data by
          opening an issue on <InlineLink href={ISSUES_URL}>GitHub Issues</InlineLink>. Please
          don&apos;t post personal details in a public issue; ask for a private channel and we
          will arrange one. Depending on where you live (for example under the GDPR or CCPA), you
          may have further rights of access, correction, deletion and portability. We honour
          reasonable requests regardless of where you live.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>
          The Service is not directed at children under 13 (or the minimum age in your
          jurisdiction), and we do not knowingly collect data from them.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Changes and contact">
        <p>
          We may update this policy from time to time; material changes will be reflected in the
          &quot;Last updated&quot; date above. Questions about privacy go to{' '}
          <InlineLink href={ISSUES_URL}>GitHub Issues</InlineLink>. Also see our{' '}
          <InlineLink href="/terms">Terms of Service</InlineLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
