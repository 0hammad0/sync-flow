import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'file-transfer-bucket';
const CRON_SECRET = process.env.CRON_SECRET;

interface ExpiredFile {
  token: string;
  file_path: string;
  original_name: string;
  expires_at: string;
}

// POST /api/cleanup - Cleanup expired files
// Can be triggered by:
// 1. Vercel Cron Jobs (add to vercel.json)
// 2. External cron service
// 3. Manual trigger (admin only)
export async function POST(request: NextRequest) {
  try {
    // Verify authorization
    const authHeader = request.headers.get('Authorization');

    // Check for cron secret or service key
    if (CRON_SECRET) {
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      // If no CRON_SECRET, require the request to come from Vercel Cron
      const isVercelCron = request.headers.get('x-vercel-cron') === '1';
      if (!isVercelCron && !authHeader) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const serviceClient = createServiceClient();

    // Find all expired anonymous files
    const { data: expiredFiles, error: fetchError } = await serviceClient
      .from('files')
      .select('token, file_path, original_name, expires_at')
      .is('owner_id', null)
      .lt('expires_at', new Date().toISOString())
      .limit(100);

    if (fetchError) {
      console.error('Error fetching expired files:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch expired files' }, { status: 500 });
    }

    if (!expiredFiles || expiredFiles.length === 0) {
      // Also clean up expired sessions
      await serviceClient
        .from('receive_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString());

      return NextResponse.json({
        success: true,
        message: 'No expired files to clean up',
        deleted: 0,
      });
    }

    console.log(`Cleanup: Found ${expiredFiles.length} expired anonymous files`);

    let deletedCount = 0;
    const errors: string[] = [];

    for (const file of expiredFiles as ExpiredFile[]) {
      try {
        // Delete from storage
        const { error: storageError } = await serviceClient.storage
          .from(BUCKET_NAME)
          .remove([file.file_path]);

        if (storageError) {
          console.error(`Storage delete error for ${file.token}:`, storageError);
          errors.push(`Storage: ${file.token}`);
          continue;
        }

        // Delete from database
        const { error: dbError } = await serviceClient
          .from('files')
          .delete()
          .eq('token', file.token);

        if (dbError) {
          console.error(`Database delete error for ${file.token}:`, dbError);
          errors.push(`Database: ${file.token}`);
          continue;
        }

        deletedCount++;
        console.log(`Deleted expired file: ${file.original_name} (${file.token})`);
      } catch (err) {
        console.error(`Error deleting file ${file.token}:`, err);
        errors.push(`Error: ${file.token}`);
      }
    }

    // Clean up expired receive sessions
    const { count: sessionsDeleted } = await serviceClient
      .from('receive_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed',
      filesDeleted: deletedCount,
      filesTotal: expiredFiles.length,
      sessionsDeleted: sessionsDeleted || 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'cleanup' });
}
