'use client';

import UploadForm from '@/features/files/components/UploadForm';
import { useSignedIn } from '@/shared/lib/auth-state';

/**
 * The home page stays statically rendered; signed-in state comes from the
 * client auth store instead of a server cookie read. UploadForm is NOT keyed
 * on that state: it derives its expiry list and default from the prop on
 * every render, so a sign-in change (late Firebase resolve, sign-out in
 * another tab) never remounts it and never drops an upload in progress.
 * The server re-checks the session itself (asMember in the presign body).
 */
export default function HomeUpload() {
  const signedIn = useSignedIn();
  return <UploadForm isAuthenticated={signedIn} />;
}
