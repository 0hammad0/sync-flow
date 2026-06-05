import { NextRequest, NextResponse } from 'next/server';
import { getRoom, isRoomExpired } from '@/lib/firebase/chat';
import { isValidRoomCode } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  const { roomCode } = await params;
  const code = (roomCode || '').toUpperCase();

  if (!isValidRoomCode(code)) {
    return NextResponse.json(
      { success: false, error: 'invalid_code' },
      { status: 400 }
    );
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      return NextResponse.json(
        { success: false, error: 'not_found' },
        { status: 404 }
      );
    }
    if (isRoomExpired(room)) {
      return NextResponse.json(
        { success: false, error: 'expired' },
        { status: 410 }
      );
    }
    return NextResponse.json({ success: true, room });
  } catch (err) {
    console.error('Get room error:', err);
    return NextResponse.json(
      { success: false, error: 'unexpected' },
      { status: 500 }
    );
  }
}
