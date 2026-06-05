import { NextRequest, NextResponse } from 'next/server';
import {
  deleteExpiredReceiveSessions,
  deleteFile as fsDeleteFile,
  listExpiredAnonymousFiles,
} from '@/lib/firebase/files';
import { deleteExpiredRooms } from '@/lib/firebase/chat';
import { deleteObject } from '@/lib/r2';

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (CRON_SECRET) {
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      const isVercelCron = request.headers.get('x-vercel-cron') === '1';
      if (!isVercelCron && !authHeader) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const expired = await listExpiredAnonymousFiles(100);
    const sessionsDeleted = await deleteExpiredReceiveSessions();

    let filesDeleted = 0;
    const errors: string[] = [];
    for (const file of expired) {
      try {
        await deleteObject(file.file_path);
        await fsDeleteFile(file.token);
        filesDeleted++;
      } catch (err) {
        console.error(`Cleanup error for ${file.token}:`, err);
        errors.push(file.token);
      }
    }

    let roomsDeleted = 0;
    try {
      roomsDeleted = await deleteExpiredRooms();
    } catch (err) {
      console.error('Chat-room cleanup error:', err);
    }

    return NextResponse.json({
      success: true,
      message:
        filesDeleted + roomsDeleted + sessionsDeleted === 0
          ? 'Nothing to clean up'
          : 'Cleanup completed',
      filesDeleted,
      filesTotal: expired.length,
      sessionsDeleted,
      roomsDeleted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'cleanup' });
}
