'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileRecord } from '@/types';
import { formatFileSize, getBaseUrl } from '@/lib/utils';
import { deleteFile } from '@/actions/files';
import CopyButton from './CopyButton';
import LoadingSpinner from './LoadingSpinner';
import Link from 'next/link';

interface FileListProps {
  files: FileRecord[];
}

export default function FileList({ files }: FileListProps) {
  const router = useRouter();
  const [deletingToken, setDeletingToken] = useState<string | null>(null);

  const handleDelete = async (token: string) => {
    if (!confirm('Are you sure you want to delete this file? This action cannot be undone and the share link will stop working.')) {
      return;
    }

    setDeletingToken(token);
    const result = await deleteFile(token);

    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || 'Failed to delete file');
    }

    setDeletingToken(null);
  };

  if (files.length === 0) {
    return (
      <div className="text-center py-10 sm:py-12 md:py-16 border border-dashed border-gray-300 rounded-xl animate-fade-in">
        <div className="text-4xl sm:text-5xl mb-3 sm:mb-4">📂</div>
        <p className="text-gray-600 text-sm sm:text-base font-medium">No files uploaded yet</p>
        <p className="text-xs sm:text-sm text-gray-400 mt-1 mb-4">
          Files you upload while signed in will appear here.
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors duration-200 cursor-pointer btn-hover"
        >
          Upload your first file
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:space-y-3">
      <p className="text-xs text-gray-500 mb-3">
        {files.length} {files.length === 1 ? 'file' : 'files'} uploaded &bull; Click &quot;Copy&quot; to get the share link
      </p>
      {files.map((file, index) => {
        const shareUrl = `${getBaseUrl()}/share/${file.token}`;
        const isDeleting = deletingToken === file.token;

        return (
          <div
            key={file.id}
            className="border border-gray-200 rounded-xl p-3 sm:p-4 bg-white card-hover animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 truncate text-sm sm:text-base" title={file.original_name}>
                  {file.original_name}
                </h3>
                <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                  {formatFileSize(file.size)} • Uploaded {new Date(file.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <CopyButton text={shareUrl} />
                <button
                  onClick={() => handleDelete(file.token)}
                  disabled={isDeleting}
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 min-w-[70px] sm:min-w-[80px] ${
                    isDeleting
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer btn-hover'
                  }`}
                  title="Permanently delete this file"
                >
                  {isDeleting ? (
                    <>
                      <LoadingSpinner size="sm" className="text-gray-400" />
                      <span className="hidden sm:inline">Deleting</span>
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-gray-400 text-center pt-2">
        Deleting a file will permanently remove it and disable its share link.
      </p>
    </div>
  );
}
