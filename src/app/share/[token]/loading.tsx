import LoadingSpinner from '@/components/LoadingSpinner';

export default function ShareLoading() {
  return (
    <div className="py-4 sm:py-6 md:py-8 px-4 sm:px-0">
      <div className="w-full max-w-sm sm:max-w-md mx-auto border border-gray-200 rounded-xl p-5 sm:p-6 md:p-8 bg-white shadow-sm animate-fade-in">
        <div className="flex flex-col items-center justify-center py-8">
          <LoadingSpinner size="lg" className="text-blue-600" />
          <p className="mt-4 text-sm sm:text-base text-gray-500">Loading file...</p>
        </div>
      </div>
    </div>
  );
}
