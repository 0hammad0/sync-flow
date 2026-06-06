import LoadingSpinner from '@/components/LoadingSpinner';

export default function ShareLoading() {
  return (
    <div className="py-4 sm:py-6 md:py-8">
      <div className="w-full max-w-sm sm:max-w-md mx-auto border border-edge rounded-3xl p-5 sm:p-6 md:p-8 bg-surface shadow-[var(--shadow-card)] animate-fade-in">
        <div className="flex flex-col items-center justify-center py-8">
          <LoadingSpinner size="lg" className="text-brand-text" />
          <p className="mt-4 text-sm sm:text-base text-fg-muted">Loading file...</p>
        </div>
      </div>
    </div>
  );
}
