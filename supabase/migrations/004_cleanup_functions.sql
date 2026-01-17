-- Cleanup Functions for Expired Files
-- Run this in Supabase SQL Editor

-- Function to get expired anonymous files (for Edge Function to process)
CREATE OR REPLACE FUNCTION get_expired_anonymous_files(batch_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  token VARCHAR(32),
  file_path TEXT,
  original_name TEXT,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT f.token, f.file_path, f.original_name, f.expires_at
  FROM files f
  WHERE f.owner_id IS NULL
    AND f.expires_at IS NOT NULL
    AND f.expires_at < NOW()
  LIMIT batch_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete a file record (called after storage deletion)
CREATE OR REPLACE FUNCTION delete_file_record(file_token VARCHAR(32))
RETURNS BOOLEAN AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM files WHERE token = file_token;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up expired receive sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM receive_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for monitoring: shows files that will be auto-deleted
CREATE OR REPLACE VIEW expired_files_summary AS
SELECT
  COUNT(*) FILTER (WHERE owner_id IS NULL AND expires_at < NOW()) as expired_anonymous,
  COUNT(*) FILTER (WHERE owner_id IS NOT NULL AND expires_at < NOW()) as expired_owned,
  COUNT(*) FILTER (WHERE expires_at IS NULL) as never_expires,
  COUNT(*) FILTER (WHERE expires_at > NOW()) as active,
  SUM(size) FILTER (WHERE owner_id IS NULL AND expires_at < NOW()) as expired_anonymous_bytes
FROM files;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_expired_anonymous_files TO service_role;
GRANT EXECUTE ON FUNCTION delete_file_record TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_sessions TO service_role;

-- ============================================
-- OPTIONAL: pg_cron setup (requires extension)
-- ============================================
-- Uncomment below if you have pg_cron enabled in your Supabase project
-- This runs the Edge Function every hour via HTTP

-- Enable pg_cron extension (if not already enabled)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup to run every hour
-- SELECT cron.schedule(
--   'cleanup-expired-files',
--   '0 * * * *',  -- Every hour at minute 0
--   $$
--   SELECT net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-expired',
--     headers := '{"Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
--   );
--   $$
-- );

-- To remove the scheduled job:
-- SELECT cron.unschedule('cleanup-expired-files');
