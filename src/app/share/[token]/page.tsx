import { getFileByToken } from '@/actions/files';
import DownloadCard from '@/components/DownloadCard';
import Link from 'next/link';

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  const downloadInfo = await getFileByToken(token);

  // Handle expired file
  if (!downloadInfo.success && downloadInfo.error === 'expired') {
    return (
      <div className="py-8 sm:py-12 text-center px-4 animate-fade-in">
        <div className="text-5xl sm:text-6xl mb-3 sm:mb-4">⏰</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Link Expired</h1>
        <p className="text-sm sm:text-base text-gray-600 mb-2 max-w-md mx-auto">
          This file&apos;s sharing link has expired.
        </p>
        <p className="text-xs sm:text-sm text-gray-500 mb-6 max-w-md mx-auto">
          The uploader set an expiration time for this link. Contact them if you still need the file.
        </p>
        <Link
          href="/"
          className="inline-block px-5 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all duration-200 cursor-pointer btn-hover text-sm sm:text-base"
        >
          Upload your own file
        </Link>
        <p className="mt-4 text-xs text-gray-400">
          Need to share a file? It only takes a few seconds.
        </p>
      </div>
    );
  }

  // Handle download limit reached
  if (!downloadInfo.success && downloadInfo.error === 'download_limit_reached') {
    return (
      <div className="py-8 sm:py-12 text-center px-4 animate-fade-in">
        <div className="text-5xl sm:text-6xl mb-3 sm:mb-4">🚫</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Download Limit Reached</h1>
        <p className="text-sm sm:text-base text-gray-600 mb-2 max-w-md mx-auto">
          This file has reached its maximum download limit.
        </p>
        <p className="text-xs sm:text-sm text-gray-500 mb-6 max-w-md mx-auto">
          The uploader set a download limit for security. The file has been automatically deleted.
        </p>
        <Link
          href="/"
          className="inline-block px-5 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all duration-200 cursor-pointer btn-hover text-sm sm:text-base"
        >
          Upload your own file
        </Link>
        <p className="mt-4 text-xs text-gray-400">
          Need to share a file? It only takes a few seconds.
        </p>
      </div>
    );
  }

  // Handle generic not found
  if (!downloadInfo.success || !downloadInfo.signedUrl) {
    return (
      <div className="py-8 sm:py-12 text-center px-4 animate-fade-in">
        <div className="text-5xl sm:text-6xl mb-3 sm:mb-4">🔍</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">File Not Found</h1>
        <p className="text-sm sm:text-base text-gray-600 mb-2 max-w-md mx-auto">
          We couldn&apos;t find the file you&apos;re looking for.
        </p>
        <p className="text-xs sm:text-sm text-gray-500 mb-6 max-w-md mx-auto">
          This could happen if:
        </p>
        <ul className="text-xs sm:text-sm text-gray-500 mb-6 max-w-xs mx-auto text-left space-y-1">
          <li className="flex items-start gap-2">
            <span className="text-gray-400">•</span>
            <span>The file was deleted by the owner</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400">•</span>
            <span>The link was typed incorrectly</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gray-400">•</span>
            <span>The link has expired or is invalid</span>
          </li>
        </ul>
        <Link
          href="/"
          className="inline-block px-5 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all duration-200 cursor-pointer btn-hover text-sm sm:text-base"
        >
          Upload your own file
        </Link>
        <p className="mt-4 text-xs text-gray-400">
          Need to share a file? It only takes a few seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="py-4 sm:py-6 md:py-8 px-4 sm:px-0">
      <DownloadCard
        fileName={downloadInfo.fileName!}
        fileSize={downloadInfo.fileSize!}
        mimeType={downloadInfo.mimeType!}
        signedUrl={downloadInfo.signedUrl}
        isEncrypted={downloadInfo.isEncrypted || false}
        createdAt={downloadInfo.createdAt || new Date().toISOString()}
        expiresAt={downloadInfo.expiresAt || null}
        downloadsRemaining={downloadInfo.downloadsRemaining ?? null}
        token={downloadInfo.token || token}
      />
    </div>
  );
}
