import Link from 'next/link';
import EmptyState from '@/shared/ui/EmptyState';
import ForbiddenIllustration from '@/shared/ui/illustrations/Forbidden';

// Stand-in. The sign-in branch owns the real screen at this path.
export default function Forbidden({ email }: { email: string | null }) {
  return (
    <div className="mx-auto w-full max-w-[420px] py-12">
      <EmptyState
        size="page"
        titleAs="h1"
        illustration={<ForbiddenIllustration />}
        title="This account isn't an admin"
        body={
          email ? (
            <>
              Signed in as <strong>{email}</strong>. Ask the owner for a role, then sign in again.
            </>
          ) : (
            'Ask the owner for a role, then sign in again.'
          )
        }
        action={<Link href="/">Back to site</Link>}
      />
    </div>
  );
}
