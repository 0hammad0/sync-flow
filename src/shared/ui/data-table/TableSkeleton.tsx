import Skeleton from '@/shared/ui/Skeleton';
import { PAGE_SIZE } from './types';
import { PRIORITY_CELL } from './styles';

export type SkeletonColumn = {
  id: string;
  /** The real header text: the header stays readable while rows load. */
  label: string;
  priority: 1 | 2 | 3;
  align?: 'left' | 'right';
  width?: number;
};

type TableSkeletonProps = {
  /** "Loading sessions": the one thing a screen reader hears. */
  label: string;
  columns: SkeletonColumn[];
  rows?: number;
  selectable?: boolean;
  withActions?: boolean;
};

// Varied widths so the placeholder reads as text, not as a grid of bars.
const TEXT_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6'] as const;

/**
 * First load only (refreshes keep the old rows, faded). A real header and
 * `rows` rows at the density's row height. Number cells are short and
 * right-aligned like the values they stand for.
 */
export default function TableSkeleton({
  label,
  columns,
  rows = PAGE_SIZE,
  selectable = false,
  withActions = false,
}: TableSkeletonProps) {
  return (
    <div aria-busy="true" className="relative">
      <span className="sr-only" role="status">
        {label}
      </span>
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="h-9 border-b border-edge bg-surface-2 text-xs font-medium text-fg-muted">
            {selectable && <th scope="col" className="w-10" aria-hidden="true" />}
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={`px-3 font-medium ${column.align === 'right' ? 'text-right' : 'text-left'} ${PRIORITY_CELL[column.priority]}`}
              >
                {column.label}
              </th>
            ))}
            {withActions && <th scope="col" className="w-12" aria-hidden="true" />}
          </tr>
        </thead>
        <tbody aria-hidden="true">
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} className="h-[var(--admin-row-h)] border-b border-edge pointer-coarse:h-12">
              {selectable && (
                <td className="w-10 px-3">
                  <Skeleton shape="block" className="size-4" />
                </td>
              )}
              {columns.map((column, col) => (
                <td key={column.id} className={`px-3 ${PRIORITY_CELL[column.priority]}`}>
                  <Skeleton
                    className={
                      column.align === 'right' ? 'ml-auto w-10' : TEXT_WIDTHS[(row + col) % TEXT_WIDTHS.length]
                    }
                  />
                </td>
              ))}
              {withActions && <td className="w-12" />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card placeholders for screens in card mode: 8 at the real card height. */
export function CardListSkeleton({ label, count = 8 }: { label: string; count?: number }) {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <ul aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="flex flex-col gap-2 border-b border-edge p-3">
            <div className="flex justify-between gap-3">
              <Skeleton className="w-1/2" />
              <Skeleton className="w-12" />
            </div>
            <Skeleton className="w-2/3" />
            <Skeleton className="w-5/6" />
          </li>
        ))}
      </ul>
    </div>
  );
}
