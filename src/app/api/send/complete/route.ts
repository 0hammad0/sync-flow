import { NextRequest, NextResponse } from 'next/server';
import { readUploadTicket, verifyUploadedObject } from '@/shared/lib/upload-ticket';
import { finishSendUpload, type SendUploadPlan } from '@/features/files/server/send-upload';
import { assertNotBlocked, blockedApiResponse } from '@/server/blocklist/assert-not-blocked';

/**
 * Step 3 of a direct-to-R2 phone → PC upload. Body (JSON): { ticket }.
 * The session was open at presign time; a large file may finish after the
 * session window and is still delivered (the PC keeps polling for
 * SEND_LATE_FILE_GRACE_MS after expiry). The session and receiver file caps
 * are re-checked in finishSendUpload, since tickets are stateless.
 */
export async function POST(request: NextRequest) {
  const blocked = await assertNotBlocked();
  if (blocked) return blockedApiResponse(blocked);
  try {
    const body = await request.json().catch(() => null);
    const data = readUploadTicket<{ kind: string; plan: SendUploadPlan }>(body?.ticket);
    if (!data || data.kind !== 'send') {
      return NextResponse.json(
        { success: false, error: 'This upload has expired or is invalid. Please send it again.' },
        { status: 400 }
      );
    }

    const problem = await verifyUploadedObject(data.plan.key, data.plan.size);
    if (problem) {
      return NextResponse.json({ success: false, error: problem }, { status: 400 });
    }

    return finishSendUpload(data.plan);
  } catch (error) {
    console.error('Send complete error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
