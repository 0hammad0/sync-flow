import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/shared/lib/firebase/session';
import { ALLOWED_TTL_HOURS, createRoom, MAX_ROOM_NAME_LENGTH } from '@/shared/lib/firebase/chat';
import { getRequestOrigin, sanitizeIanaTz } from '@/shared/lib/utils';
import { clientKey, rateLimit } from '@/shared/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rl = rateLimit(`chat:create:${clientKey(request)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many room creations, slow down.' },
      { status: 429, headers: { 'Retry-After': Math.ceil(rl.retryAfterMs / 1000).toString() } }
    );
  }

  let body: { name?: unknown; ttlHours?: unknown; tz?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const ttlHours = Number(body.ttlHours);
  if (!ALLOWED_TTL_HOURS.includes(ttlHours as 1 | 24 | 168)) {
    return NextResponse.json(
      { success: false, error: 'ttlHours must be 1, 24, or 168' },
      { status: 400 }
    );
  }

  let name: string | null = null;
  if (body.name != null && body.name !== '') {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ success: false, error: 'name must be a string' }, { status: 400 });
    }
    const trimmed = body.name.trim().slice(0, MAX_ROOM_NAME_LENGTH);
    name = trimmed.length > 0 ? trimmed : null;
  }

  const tz = sanitizeIanaTz(body.tz);

  try {
    const user = await currentUser();
    const room = await createRoom({
      name,
      ttl_hours: ttlHours as 1 | 24 | 168,
      created_by: user?.uid ?? null,
      creator_tz: tz,
    });
    return NextResponse.json({
      success: true,
      code: room.code,
      url: `${getRequestOrigin(request.headers)}/chat/${room.code}`,
      expiresAt: room.expires_at,
      ttlHours: room.ttl_hours,
      name: room.name,
    });
  } catch (err) {
    console.error('Create room error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create room' },
      { status: 500 }
    );
  }
}
