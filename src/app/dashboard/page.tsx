import { getUserFiles } from '@/actions/files';
import FileList from '@/components/FileList';
import Link from 'next/link';

export default async function DashboardPage() {
  const files = await getUserFiles();

  return (
    <div className="py-2 sm:py-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Files</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Manage and share your uploaded files
          </p>
        </div>
        <Link
          href="/"
          className="w-full sm:w-auto text-center px-4 py-2.5 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium cursor-pointer btn-hover transition-all duration-200"
          title="Upload a new file to share"
        >
          Upload New File
        </Link>
      </div>

      <FileList files={files} />

      {files.length > 0 && (
        <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Quick Tips
          </h3>
          <ul className="text-xs text-gray-600 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>Click <strong>Copy</strong> to get a file&apos;s share link</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>Share links work for anyone, no account needed</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>Deleted files cannot be recovered</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
