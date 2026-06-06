import { getFileByToken } from '@/actions/files';
import DownloadCard from '@/components/DownloadCard';
import Button from '@/components/ui/Button';
import { Clock, FileQuestion, ShieldAlert } from 'lucide-react';

interface SharePageProps {
  params: Promise<{ token: string }>;
}

function ErrorState({
  icon: Icon,
  title,
  message,
  detail,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-10 sm:py-14 text-center animate-fade-in">
      <span className="inline-flex w-16 h-16 sm:w-20 sm:h-20 mb-4 rounded-3xl bg-surface-2 border border-edge text-fg-faint items-center justify-center">
        <Icon className="w-8 h-8 sm:w-10 sm:h-10" />
      </span>
      <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">{title}</h1>
      <p className="text-sm sm:text-base text-fg-muted mb-2 max-w-md mx-auto">{message}</p>
      {detail && (
        <p className="text-xs sm:text-sm text-fg-faint mb-6 max-w-md mx-auto">{detail}</p>
      )}
      {children}
      <div className="mt-6">
        <Button href="/" variant="primary" size="lg">
          Upload your own file
        </Button>
      </div>
      <p className="mt-4 text-xs text-fg-faint">
        Need to share a file? It only takes a few seconds.
      </p>
    </div>
  );
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  const downloadInfo = await getFileByToken(token);

  // Handle expired file
  if (!downloadInfo.success && downloadInfo.error === 'expired') {
    return (
      <ErrorState
        icon={Clock}
        title="Link Expired"
        message="This file's sharing link has expired."
        detail="The uploader set an expiration time for this link. Contact them if you still need the file."
      />
    );
  }

  // Handle download limit reached
  if (!downloadInfo.success && downloadInfo.error === 'download_limit_reached') {
    return (
      <ErrorState
        icon={ShieldAlert}
        title="Download Limit Reached"
        message="This file has reached its maximum download limit."
        detail="The uploader set a download limit for security. The file has been automatically deleted."
      />
    );
  }

  // Handle generic not found
  if (!downloadInfo.success || !downloadInfo.signedUrl) {
    return (
      <ErrorState
        icon={FileQuestion}
        title="File Not Found"
        message="We couldn't find the file you're looking for."
        detail="The file may have been deleted by its owner, the link may have been typed incorrectly, or it has expired."
      />
    );
  }

  return (
    <div className="py-4 sm:py-6 md:py-8">
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
