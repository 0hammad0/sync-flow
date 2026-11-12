import type { Metadata } from 'next';
import { InlineLink, LegalPage, LegalSection } from '@/shared/components/LegalPage';
import { ISSUES_URL } from '@/shared/lib/site';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms that govern your use of SyncFlow: file sharing, Phone → PC transfers and temporary chat rooms.',
  alternates: { canonical: '/terms' },
};

const LAST_UPDATED = 'November 12, 2026';

const SECTIONS = [
  { id: 'agreement', title: 'Agreement' },
  { id: 'service', title: 'The Service and its limits' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'acceptable-use', title: 'Acceptable use' },
  { id: 'content', title: 'Your content' },
  { id: 'encryption', title: 'Encryption and links' },
  { id: 'ai', title: 'Optional AI features' },
  { id: 'disclaimers', title: 'Disclaimers and liability' },
  { id: 'changes', title: 'Changes to these terms' },
  { id: 'contact', title: 'Contact' },
];

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={LAST_UPDATED} sections={SECTIONS}>
      <LegalSection id="agreement" title="Agreement">
        <p>
          By accessing or using SyncFlow (the &quot;Service&quot;), including uploading files,
          creating share links, transferring files between devices or using temporary chat rooms,
          you agree to these Terms of Service. If you do not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection id="service" title="The Service and its limits">
        <p>SyncFlow is free and open source (MIT licence). It offers three tools:</p>
        <ul>
          <li>
            <strong>Share files:</strong> upload files of up to 100 MB each and share them by
            link, QR code or email. Without an account, links expire after 1 hour, 24 hours or 7
            days; signed-in users can also choose 30 days or no expiry. You can set an optional
            download limit.
          </li>
          <li>
            <strong>Phone → PC:</strong> open a session on your computer, scan its QR code with
            your phone and send up to 25 files (100 MB each). A session accepts files for 10
            minutes.
          </li>
          <li>
            <strong>Chat rooms:</strong> temporary rooms that last 1 hour, 24 hours or 7 days, with
            attachments of up to 100 MB, reactions and replies.
          </li>
        </ul>
        <p>
          The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We
          may change, suspend or discontinue any part of the Service at any time without notice.
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="Accounts">
        <p>
          You can use the Service without an account. Signing in uses one-time email links, so
          you are responsible for keeping control of your email account. Signed-in users can keep
          up to 10 files at a time in My Files. We may suspend or terminate accounts that violate
          these terms.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="Acceptable use">
        <p>You agree not to use the Service to upload, share or transmit content that:</p>
        <ul>
          <li>is illegal, or that you do not have the rights to share;</li>
          <li>infringes any copyright, trademark or other intellectual-property right;</li>
          <li>contains malware, viruses or any other harmful code;</li>
          <li>constitutes child sexual abuse material, or exploits or harms minors;</li>
          <li>harasses, threatens or defames any person;</li>
          <li>attempts to disrupt, overload or gain unauthorized access to the Service.</li>
        </ul>
        <p>
          We may remove any content and block any user at our sole discretion, including in
          response to abuse reports or legal requests.
        </p>
      </LegalSection>

      <LegalSection id="content" title="Your content">
        <p>
          You keep all rights to the files and messages you upload. By using the Service you grant
          us a limited licence to store, transmit and display your content only as needed to
          operate the Service (for example, storing a file so the people you share the link with
          can download it).
        </p>
        <p>
          Share links stop working when they expire or reach their download limit, and expired
          chat rooms are deleted automatically. Expired or deleted content cannot be recovered, so
          keep your own copies of anything important.
        </p>
      </LegalSection>

      <LegalSection id="encryption" title="Encryption and links">
        <p>
          File shares are end-to-end encrypted by default, and you can switch encryption off per
          upload. When it is on, the decryption key is embedded in the part of the share link
          after the # and never reaches our servers. Anyone who has the full link can decrypt and
          download the file, so treat share links like the files themselves and only send them to
          people you trust.
        </p>
        <p>
          Phone → PC transfers and chat rooms (messages and attachments) are encrypted in transit
          but are <strong>not</strong> end-to-end encrypted, and our servers can read them.
        </p>
      </LegalSection>

      <LegalSection id="ai" title="Optional AI features">
        <p>
          Where the operator has enabled them, chat rooms offer AI features (summaries, reply
          suggestions, rewrite, translate and explain code). They run only when you trigger them,
          and the text involved is sent to OpenRouter and an upstream AI model provider, as
          described in our <InlineLink href="/privacy#ai">Privacy Policy</InlineLink>. AI output
          can be inaccurate or incomplete; you are responsible for checking it before you use or
          share it.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" title="Disclaimers and liability">
        <p>
          To the maximum extent permitted by law, SyncFlow disclaims all warranties, express or
          implied, including merchantability, fitness for a particular purpose and
          non-infringement. We do not guarantee that the Service will be uninterrupted, secure or
          error-free, or that stored content will not be lost.
        </p>
        <p>
          To the maximum extent permitted by law, SyncFlow shall not be liable for any indirect,
          incidental, special, consequential or punitive damages, or any loss of data, arising
          from your use of the Service.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          We may update these terms from time to time. Material changes will be reflected by
          updating the &quot;Last updated&quot; date above. Continuing to use the Service after
          changes take effect means you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms? Open an issue on{' '}
          <InlineLink href={ISSUES_URL}>GitHub Issues</InlineLink>, which is our only contact
          channel. Also see our <InlineLink href="/privacy">Privacy Policy</InlineLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
