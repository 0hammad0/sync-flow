import LoadingSpinner from '@/components/LoadingSpinner';

export default function DashboardLoading() {
  return (
    <div className="py-2 sm:py-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="h-7 sm:h-8 w-32 bg-gray-200 rounded-lg skeleton" />
        <div className="h-10 w-full sm:w-36 bg-gray-200 rounded-lg skeleton" />
      </div>

      <div className="flex flex-col items-center justify-center py-12 sm:py-16">
        <LoadingSpinner size="lg" className="text-blue-600" />
        <p className="mt-4 text-sm sm:text-base text-gray-500">Loading your files...</p>
      </div>
    </div>
  );
}
