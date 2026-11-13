import Link from 'next/link';
import EmptyState from '@/shared/ui/EmptyState';
import ForbiddenIllustration from '@/shared/ui/illustrations/Forbidden';
import AdminAuthFrame from './AdminAuthFrame';
import SignOutButton from './SignOutButton';

/**
 * Signed in, but no admin role: rendered by the shell layout instead of the
 * shell (never the sign-in page). Copy: docs/admin/02-design/06-states.md 6.5.
 * Server component; only the sign-out button is client code.
 */
export default function Forbidden({ email }: { email: string | null }) {
  return (
    <AdminAuthFrame>
      <EmptyState
        size="page"
        titleAs="h1"
        illustration={<ForbiddenIllustration />}
        title="This account isn’t an admin"
        body={
          <>
            Signed in as {email ? <strong className="font-medium break-all text-fg">{email}</strong> : 'an account with no email'}.
            Ask the owner for a role, then sign in again.
          </>
        }
        action={<SignOutButton />}
        secondaryAction={
          <Link href="/" className="px-2 py-2.5 text-sm font-medium text-fg-muted hover:text-fg hover:underline">
            Back to site
          </Link>
        }
      />
    </AdminAuthFrame>
  );
}
