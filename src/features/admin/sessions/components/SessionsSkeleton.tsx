import TableSkeleton from '@/shared/ui/data-table/TableSkeleton';

/** Sessions table while it loads (04-sessions.md "States"): 10 rows of the real columns. */
export default function SessionsSkeleton() {
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <TableSkeleton
        label="Loading sessions"
        rows={10}
        columns={[
          { id: 'started', label: 'Started', priority: 1 },
          { id: 'duration', label: 'Duration', priority: 1, align: 'right', width: 88 },
          { id: 'pages', label: 'Pages', priority: 3, align: 'right', width: 64 },
          { id: 'paths', label: 'Entry → exit', priority: 1, width: 220 },
          { id: 'place', label: 'Place', priority: 2, width: 140 },
          { id: 'device', label: 'Device', priority: 3, width: 140 },
          { id: 'source', label: 'Source', priority: 3, width: 140 },
          { id: 'ip', label: 'IP', priority: 1, width: 170 },
          { id: 'user', label: 'User', priority: 3, width: 104 },
        ]}
      />
    </div>
  );
}
