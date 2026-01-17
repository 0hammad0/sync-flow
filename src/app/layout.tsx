import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getMetadataBaseUrl(): URL {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return new URL(process.env.NEXT_PUBLIC_APP_URL);
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: getMetadataBaseUrl(),
  title: {
    default: "SyncFlow - Fast & Secure File Sharing",
    template: "%s | SyncFlow",
  },
  description:
    "Share files instantly with end-to-end encryption. Upload, get a link, and share. Transfer files between phone and PC with QR codes. No sign-up required.",
  keywords: [
    "file sharing",
    "file transfer",
    "send files",
    "share files",
    "encrypted file sharing",
    "QR code transfer",
    "phone to PC",
    "secure upload",
    "instant file sharing",
  ],
  authors: [{ name: "SyncFlow" }],
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
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "SyncFlow",
    title: "SyncFlow - Fast & Secure File Sharing",
    description:
      "Share files instantly with end-to-end encryption. Transfer between devices with QR codes. No sign-up required.",
    images: [
      {
        url: "/logo.png",
        width: 512,
        height: 512,
        alt: "SyncFlow Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SyncFlow - Fast & Secure File Sharing",
    description:
      "Share files instantly with end-to-end encryption. Transfer between devices with QR codes.",
    images: ["/logo.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [
      { url: "/logo.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 min-h-screen`}
        suppressHydrationWarning
      >
        <Header />
        <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
