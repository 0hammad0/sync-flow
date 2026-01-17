// Supabase Edge Function: Cleanup Expired Files
// This function runs on a schedule to delete expired anonymous files
// Deploy with: supabase functions deploy cleanup-expired
// Schedule with: cron job in Supabase Dashboard or pg_cron

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET_NAME = Deno.env.get('STORAGE_BUCKET') || 'file-transfer-bucket';

interface ExpiredFile {
  token: string;
  file_path: string;
  original_name: string;
  expires_at: string;
}

Deno.serve(async (req) => {
  try {
    // Verify the request is authorized (from cron or admin)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find all expired anonymous files
    const { data: expiredFiles, error: fetchError } = await supabase
      .from('files')
      .select('token, file_path, original_name, expires_at')
      .is('owner_id', null) // Only anonymous files
      .lt('expires_at', new Date().toISOString()) // Expired
      .limit(100); // Process in batches

    if (fetchError) {
      console.error('Error fetching expired files:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch expired files' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!expiredFiles || expiredFiles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No expired files to clean up',
        deleted: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${expiredFiles.length} expired anonymous files to clean up`);

    let deletedCount = 0;
    const errors: string[] = [];

    for (const file of expiredFiles as ExpiredFile[]) {
      try {
        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([file.file_path]);

        if (storageError) {
          console.error(`Storage delete error for ${file.token}:`, storageError);
          errors.push(`Storage: ${file.token}`);
          continue;
        }

        // Delete from database
        const { error: dbError } = await supabase
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

    // Also clean up expired receive sessions
    const { error: sessionError } = await supabase
      .from('receive_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString());

    if (sessionError) {
      console.error('Error cleaning up expired sessions:', sessionError);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Cleanup completed`,
      deleted: deletedCount,
      total: expiredFiles.length,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Cleanup function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
