import Skeleton from '@/shared/ui/Skeleton';

const HEADER_WIDTHS = ['w-[60%]', 'w-[45%]', 'w-[50%]', 'w-[70%]'];
const GROUPS = ['g1', 'g2', 'g3', 'g4', 'g5'];

/** Session detail while it loads (04-sessions.md "States"): 4 header lines, 5 timeline groups. */
export default function SessionLoading() {
  return (
    <div aria-busy="true" className="max-w-5xl">
      <span role="status" className="sr-only">
        Loading session
      </span>
      <Skeleton className="mb-4 h-4 w-20" />
      <Skeleton className="h-6 w-56 max-w-full" />
      <div className="mt-6 flex flex-col gap-3">
        {HEADER_WIDTHS.map((w) => (
          <Skeleton key={w} className={`h-4 ${w}`} />
        ))}
      </div>
      <div className="mt-8 flex max-w-[880px] flex-col gap-5">
        {GROUPS.map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <Skeleton className="h-[18px] w-1/2" />
            <Skeleton className="ml-6 h-3.5 w-1/3" />
            <Skeleton className="ml-6 h-3.5 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
