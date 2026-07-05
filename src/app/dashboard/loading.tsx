import LoadingSpinner from '@/shared/components/LoadingSpinner';

export default function DashboardLoading() {
  return (
    <div className="py-2 sm:py-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="h-8 sm:h-9 w-36 rounded-xl skeleton" />
        <div className="h-10 w-full sm:w-40 rounded-xl skeleton" />
      </div>

      <div className="space-y-3">
        <div className="h-20 rounded-2xl skeleton" />
        <div className="h-20 rounded-2xl skeleton" />
      </div>

      <div className="flex flex-col items-center justify-center py-10 sm:py-12">
        <LoadingSpinner size="lg" className="text-brand-text" />
        <p className="mt-4 text-sm sm:text-base text-fg-muted">Loading your files...</p>
      </div>
    </div>
  );
}
