import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms that govern your use of SyncFlow — file sharing, transfers, and temporary chat rooms.',
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

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 sm:py-12 animate-fade-in">
      <div className="mb-8 sm:mb-10">
        <p className="label-mono mb-3">Legal</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-fg mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-fg-muted">
          Last updated: <span className="font-mono">{LAST_UPDATED}</span>
        </p>
      </div>

      <div>
        <Section n="01" title="Agreement">
          <p>
            By accessing or using SyncFlow (the &quot;Service&quot;) — including uploading files,
            creating share links, transferring files between devices, or using temporary chat
            rooms — you agree to these Terms of Service. If you do not agree, do not use the
            Service.
          </p>
        </Section>

        <Section n="02" title="The Service">
          <p>
            SyncFlow lets you upload files (up to 100MB each), share them via unique links,
            transfer files between your phone and computer with QR codes, and create temporary
            chat rooms. Files can be end-to-end encrypted in your browser before upload, and
            share links can be set to expire or self-destruct after a download limit.
          </p>
          <p>
            The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis.
            We may change, suspend, or discontinue any part of the Service at any time without
            notice.
          </p>
        </Section>

        <Section n="03" title="Accounts">
          <p>
            You can use most of the Service without an account. Signing in uses passwordless
            email links — you are responsible for maintaining control of your email account.
            Signed-in users may store up to 10 active files at a time. We may terminate or
            suspend accounts that violate these terms.
          </p>
        </Section>

        <Section n="04" title="Acceptable use">
          <p>You agree not to use the Service to upload, share, or transmit content that:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>is illegal, or that you do not have the rights to share;</li>
            <li>infringes any copyright, trademark, or other intellectual-property right;</li>
            <li>contains malware, viruses, or any other harmful code;</li>
            <li>constitutes child sexual abuse material, or exploits or harms minors;</li>
            <li>harasses, threatens, or defames any person;</li>
            <li>attempts to disrupt, overload, or gain unauthorized access to the Service.</li>
          </ul>
          <p>
            We may remove any content and block any user at our sole discretion, including in
            response to abuse reports or legal requests.
          </p>
        </Section>

        <Section n="05" title="Your content">
          <p>
            You retain all rights to the files and messages you upload. By using the Service you
            grant us a limited license to store, transmit, and display your content solely as
            needed to operate the Service (for example, storing a file so the people you share
            the link with can download it).
          </p>
          <p>
            Content is ephemeral by design: expired files, exhausted download limits, and expired
            chat rooms are deleted automatically. Deleted content cannot be recovered — keep your
            own copies of anything important.
          </p>
        </Section>

        <Section n="06" title="Encryption & links">
          <p>
            When end-to-end encryption is enabled, the decryption key is embedded in the URL
            fragment of the share link and never reaches our servers. Anyone who has the full
            link can decrypt and download the file — treat share links like the files themselves
            and only send them to people you trust.
          </p>
        </Section>

        <Section n="07" title="Disclaimers & liability">
          <p>
            To the maximum extent permitted by law, SyncFlow disclaims all warranties, express or
            implied, including merchantability, fitness for a particular purpose, and
            non-infringement. We do not guarantee that the Service will be uninterrupted, secure,
            or error-free, or that stored content will not be lost.
          </p>
          <p>
            To the maximum extent permitted by law, SyncFlow shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, or any loss of
            data, arising from your use of the Service.
          </p>
        </Section>

        <Section n="08" title="Changes to these terms">
          <p>
            We may update these terms from time to time. Material changes will be reflected by
            updating the &quot;Last updated&quot; date above. Continuing to use the Service after
            changes take effect constitutes acceptance of the new terms.
          </p>
        </Section>

        <Section n="09" title="Contact">
          <p>
            Questions about these terms? See our{' '}
            <Link href="/privacy" className="text-brand-text hover:underline font-medium">
              Privacy Policy
            </Link>{' '}
            or reach out via the email on our site.
          </p>
        </Section>
      </div>
    </div>
  );
}
