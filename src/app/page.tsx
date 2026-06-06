import UploadForm from '@/components/UploadForm';
import AuthCTA from '@/components/AuthCTA';
import Reveal from '@/components/Reveal';
import Link from 'next/link';
import { currentUser } from '@/lib/firebase/session';
import {
  ArrowRight,
  MessageSquare,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

const STEPS = [
  {
    n: '01',
    title: 'Upload',
    text: 'Drag and drop or pick any file up to 100MB. Encrypted in your browser before it leaves your device.',
  },
  {
    n: '02',
    title: 'Get a link',
    text: 'A unique share link, generated instantly. The decryption key never touches our servers.',
  },
  {
    n: '03',
    title: 'Share it',
    text: 'Anyone with the link can download — no account needed. Links expire on your terms.',
  },
];

function FeatureRow({
  href,
  icon: Icon,
  title,
  text,
  cta,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 py-5 border-t border-edge transition-colors duration-300 hover:bg-surface/60 -mx-3 px-3 rounded-lg"
    >
      <div className="flex items-start gap-4 min-w-0">
        <span className="shrink-0 mt-0.5 w-9 h-9 rounded-lg bg-brand/10 text-brand-text flex items-center justify-center transition-colors duration-300 group-hover:bg-flow group-hover:text-white">
          <Icon className="w-4.5 h-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm sm:text-base text-fg font-semibold font-display tracking-tight">{title}</p>
          <p className="text-xs sm:text-sm text-fg-muted mt-0.5">{text}</p>
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text whitespace-nowrap">
        <span className="max-sm:hidden">{cta}</span>
        <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

export default async function Home() {
  const user = await currentUser();
  const isAuthenticated = !!user;
  return (
    <div className="py-6 sm:py-8 md:py-12">
      {/* Hero — asymmetric: copy left, the product (upload) right */}
      <div className="grid lg:grid-cols-[1.05fr_minmax(0,26rem)] gap-8 sm:gap-10 lg:gap-12 items-center mb-14 sm:mb-20">
        <div className="animate-fade-in">
          <p className="label-mono mb-4 sm:mb-5 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-text" />
            Encrypted file sharing — no sign-up
          </p>
          <h1 className="font-display text-[2.6rem] leading-[1.04] sm:text-6xl md:text-[4.2rem] font-bold text-fg mb-4 sm:mb-5 text-balance">
            Drop a file.
            <br />
            Get a <span className="text-flow">link</span>.
            <br />
            Done.
          </h1>
          <p className="text-sm sm:text-base text-fg-muted max-w-sm leading-relaxed">
            Files are encrypted in your browser, shared with a single link, and
            gone when you want them gone.
          </p>
          <p className="label-mono mt-6 sm:mt-8">
            100MB max&ensp;/&ensp;AES-256&ensp;/&ensp;auto-expire
          </p>
        </div>

        <div className="animate-slide-up lg:pt-2">
          <UploadForm isAuthenticated={isAuthenticated} />
        </div>
      </div>

      {/* How it works — numbered editorial rows */}
      <div className="max-w-2xl">
        <Reveal>
          <p className="label-mono mb-2">How it works</p>
        </Reveal>
        <div>
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 100}>
              <div className="group grid grid-cols-[3.5rem_1fr] sm:grid-cols-[5rem_1fr] gap-3 sm:gap-4 py-5 sm:py-6 border-t border-edge first:border-t-0">
                <span className="font-mono text-2xl sm:text-3xl text-fg-faint/60 transition-colors duration-300 group-hover:text-brand-text leading-none pt-0.5">
                  {step.n}
                </span>
                <div>
                  <h3 className="font-display font-semibold text-fg text-lg sm:text-xl tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-fg-muted mt-1 leading-relaxed max-w-md">
                    {step.text}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* More ways to move files */}
        <Reveal>
          <p className="label-mono mt-10 sm:mt-12 mb-2">More ways to move things</p>
        </Reveal>
        <div>
          <Reveal delay={80}>
            <FeatureRow
              href="/receive"
              icon={Smartphone}
              title="Phone → this PC"
              text="Scan a QR code to beam files from your phone, no cable, no app."
              cta="Receive"
            />
          </Reveal>
          <Reveal delay={160}>
            <FeatureRow
              href="/chat"
              icon={MessageSquare}
              title="Temporary chat rooms"
              text="Spin up a room, share the code, talk. Self-destructs on expiry."
              cta="Chat"
            />
          </Reveal>
        </div>

        <AuthCTA />

        <Reveal delay={120}>
          <p className="label-mono mt-10 text-center sm:text-left">
            Encrypted in transit &amp; at rest&ensp;·&ensp;download links expire automatically
          </p>
        </Reveal>
      </div>
    </div>
  );
}
