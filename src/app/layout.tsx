import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Header from "@/shared/components/Header";
import SiteFooter from "@/shared/components/SiteFooter";
import { siteUrl } from "@/shared/lib/site";
import { TrackerLoader } from "@/features/tracking/client/loader";
import { THEME_INIT_SCRIPT } from "@/shared/lib/theme-init-script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const TITLE = "SyncFlow — Private file sharing, phone-to-PC transfers and chat rooms";
const DESCRIPTION =
  "Share files with end-to-end encrypted links, send files from your phone to your PC with a QR code, or open a temporary chat room. Free, open source, no account needed.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  applicationName: "SyncFlow",
  title: {
    default: TITLE,
    template: "%s · SyncFlow",
  },
  description: DESCRIPTION,
  keywords: [
    "file sharing",
    "end-to-end encrypted file sharing",
    "send files",
    "share files",
    "phone to PC transfer",
    "QR code file transfer",
    "temporary chat room",
    "open source",
  ],
  authors: [{ name: "SyncFlow contributors", url: "https://github.com/0hammad0/sync-flow" }],
  creator: "SyncFlow",
  publisher: "SyncFlow",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Images come from the file-based opengraph-image / twitter-image routes.
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "SyncFlow",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  // favicon.ico, icon.svg and apple-icon.png are file-based (src/app/*).
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Lets env(safe-area-inset-*) report the notch / home-indicator sizes
  // (the composer and sheets already pad by them).
  viewportFit: "cover",
  // Android Chrome: shrink the layout when the keyboard opens, so the
  // fixed chat panel (and its composer) stays above the keyboard. iOS
  // ignores this; useVisualViewportHeight handles iOS.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d0c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme / js-class init (src/shared/lib/theme-init-script.ts). Allowed by hash in the admin CSP. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} antialiased bg-canvas text-fg min-h-screen flex flex-col`}
        suppressHydrationWarning
      >
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {/* Static ambient backdrop — no blur filters, no animation */}
        <div className="backdrop" aria-hidden="true" />
        <Header />
        <main id="main" tabIndex={-1} className="site-main flex-1">
          {children}
        </main>
        <SiteFooter />
        {/* Visit statistics: ~300 B loader, tracker fetched after idle; skips /admin, GPC, DNT. */}
        <TrackerLoader />
      </body>
    </html>
  );
}
