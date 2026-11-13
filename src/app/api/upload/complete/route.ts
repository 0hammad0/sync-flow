import { NextRequest, NextResponse } from 'next/server';
import { getRequestOrigin } from '@/shared/lib/utils';
import { readUploadTicket, verifyUploadedObject } from '@/shared/lib/upload-ticket';
import { finishShareUpload, type ShareUploadPlan } from '@/features/files/server/share-upload';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * Step 3 of a direct-to-R2 share upload. Body (JSON): { ticket }.
 * Checks the ticket, confirms the object in R2 has the approved size, then
 * writes the file record. Returns { shareUrl, token }.
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    const body = await request.json().catch(() => null);
    const data = readUploadTicket<{ kind: string; plan: ShareUploadPlan }>(body?.ticket);
    if (!data || data.kind !== 'share') {
      return NextResponse.json(
        { success: false, error: 'This upload has expired or is invalid. Please upload again.' },
        { status: 400 }
      );
    }

    const problem = await verifyUploadedObject(data.plan.key, data.plan.size);
    if (problem) {
      return NextResponse.json({ success: false, error: problem }, { status: 400 });
    }

    return finishShareUpload(data.plan, getRequestOrigin(request.headers));
  } catch (error) {
    console.error('Upload complete error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
