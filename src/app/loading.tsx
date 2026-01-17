import LoadingSpinner from '@/components/LoadingSpinner';

export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24 animate-fade-in">
      <LoadingSpinner size="lg" className="text-blue-600" />
      <p className="mt-4 text-sm sm:text-base text-gray-500">Loading...</p>
    </div>
  );
}
