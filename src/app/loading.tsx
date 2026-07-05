import LoadingSpinner from '@/shared/components/LoadingSpinner';

export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24 animate-fade-in">
      <LoadingSpinner size="lg" className="text-brand-text" />
      <p className="mt-4 text-sm sm:text-base text-fg-muted">Loading...</p>
    </div>
  );
}
