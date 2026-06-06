import { getUserFiles } from '@/actions/files';
import FileList from '@/components/FileList';
import MyChatRooms from '@/components/MyChatRooms';
import Button from '@/components/ui/Button';
import { Lightbulb } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const files = await getUserFiles();

  return (
    <div className="py-2 sm:py-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-5 sm:mb-7">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">My Files</h1>
          <p className="text-xs sm:text-sm text-fg-muted mt-1">
            Manage and share your uploaded files
          </p>
        </div>
        <Button
          href="/"
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
          title="Upload a new file to share"
        >
          Upload New File
        </Button>
      </div>

      <FileList files={files} />

      <MyChatRooms />

      {files.length > 0 && (
        <div className="mt-8 p-4 sm:p-5 bg-surface border border-edge rounded-2xl">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-faint uppercase tracking-widest mb-3">
            <Lightbulb className="w-3.5 h-3.5" />
            Quick Tips
          </h3>
          <ul className="text-xs text-fg-muted space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-fg-faint">•</span>
              <span>Click <strong className="text-fg">Copy</strong> to get a file&apos;s share link</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-fg-faint">•</span>
              <span>Share links work for anyone, no account needed</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-fg-faint">•</span>
              <span>Deleted files cannot be recovered</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
