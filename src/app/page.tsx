import UploadForm from '@/components/UploadForm';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="py-4 sm:py-6 md:py-8 animate-fade-in">
      <div className="text-center mb-6 sm:mb-8 px-4">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">
          Share files instantly
        </h1>
        <p className="text-sm sm:text-base text-gray-600 max-w-md mx-auto">
          Upload a file and get a shareable link in seconds.
          <br />
          <span className="text-gray-500">No sign-up required.</span>
        </p>
      </div>

      <UploadForm />

      <div className="mt-10 sm:mt-12 md:mt-16 max-w-xl mx-auto px-4">
        <div className="border-t border-gray-200 pt-8">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide text-center mb-6">
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-2xl sm:text-3xl mb-2">📤</div>
              <h3 className="font-medium text-gray-900 text-sm">1. Upload</h3>
              <p className="text-xs text-gray-500 mt-1">
                Drag and drop or select a file up to 50MB
              </p>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl mb-2">🔗</div>
              <h3 className="font-medium text-gray-900 text-sm">2. Get Link</h3>
              <p className="text-xs text-gray-500 mt-1">
                Receive a unique link to your file instantly
              </p>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl mb-2">📥</div>
              <h3 className="font-medium text-gray-900 text-sm">3. Share</h3>
              <p className="text-xs text-gray-500 mt-1">
                Anyone with the link can download the file
              </p>
            </div>
          </div>
        </div>

        {/* Receive from phone */}
        <div className="mt-8 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-lg">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">📲</span>
              <div>
                <p className="text-sm text-indigo-800 font-medium">
                  Send from phone to this PC?
                </p>
                <p className="text-xs text-indigo-600 mt-0.5">
                  Scan a QR code to instantly transfer files from your phone
                </p>
              </div>
            </div>
            <Link
              href="/receive"
              className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Receive
            </Link>
          </div>
        </div>

        <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-blue-500 text-lg">💡</span>
            <div>
              <p className="text-sm text-blue-800 font-medium">
                Want to manage your files?
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                <Link href="/login" className="underline hover:no-underline">
                  Sign in
                </Link>
                {' '}to view, organize, and delete your uploaded files anytime.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-400">
          <p>Files are stored securely with encrypted connections.</p>
          <p className="mt-1">Download links expire after 1 hour for added security.</p>
        </div>
      </div>
    </div>
  );
}
