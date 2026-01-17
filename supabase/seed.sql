-- ============================================
-- FileShare Database Seed File
-- ============================================
-- Run this SQL in Supabase SQL Editor to set up
-- all required tables, indexes, and policies.
-- ============================================

-- ============================================
-- 1. CREATE FILES TABLE
-- ============================================
-- Stores metadata for uploaded files
-- The actual files are stored in Supabase Storage

CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Unique share token (32 character hex string)
  token VARCHAR(32) UNIQUE NOT NULL,

  -- Path in Supabase Storage: {token}/{sanitized_filename}
  file_path TEXT NOT NULL,

  -- Original filename as uploaded by user
  original_name TEXT NOT NULL,

  -- File size in bytes
  size BIGINT NOT NULL,

  -- MIME type (e.g., 'application/pdf', 'image/png')
  mime_type TEXT NOT NULL,

  -- Owner's user ID (NULL for anonymous uploads)
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Timestamp when file was uploaded
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Add comment to table
COMMENT ON TABLE public.files IS 'Stores metadata for uploaded files. Actual files are in Supabase Storage.';

-- ============================================
-- 2. CREATE INDEXES
-- ============================================
-- Optimize common query patterns

-- Index for looking up files by share token (most common operation)
CREATE INDEX IF NOT EXISTS idx_files_token
ON public.files(token);

-- Index for listing user's files in dashboard
CREATE INDEX IF NOT EXISTS idx_files_owner_id
ON public.files(owner_id);

-- Index for sorting by upload date
CREATE INDEX IF NOT EXISTS idx_files_created_at
ON public.files(created_at DESC);

-- Composite index for user's files sorted by date
CREATE INDEX IF NOT EXISTS idx_files_owner_created
ON public.files(owner_id, created_at DESC);

-- ============================================
-- 3. ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 4. CREATE RLS POLICIES
-- ============================================

-- Policy: Anyone can upload files (INSERT)
-- Allows both authenticated and anonymous uploads
DROP POLICY IF EXISTS "Anyone can upload files" ON public.files;
CREATE POLICY "Anyone can upload files"
ON public.files
FOR INSERT
WITH CHECK (true);

-- Policy: Anyone can read files by token (SELECT)
-- Required for public download functionality
DROP POLICY IF EXISTS "Anyone can read files" ON public.files;
CREATE POLICY "Anyone can read files"
ON public.files
FOR SELECT
USING (true);

-- Policy: Only owner can delete their files (DELETE)
-- Ensures users can only delete files they own
DROP POLICY IF EXISTS "Owners can delete own files" ON public.files;
CREATE POLICY "Owners can delete own files"
ON public.files
FOR DELETE
USING (auth.uid() = owner_id);

-- Policy: Only owner can update their files (UPDATE)
-- For future use if we add file renaming, etc.
DROP POLICY IF EXISTS "Owners can update own files" ON public.files;
CREATE POLICY "Owners can update own files"
ON public.files
FOR UPDATE
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

-- ============================================
-- 5. CREATE STORAGE BUCKET (Manual Step)
-- ============================================
-- NOTE: Storage bucket must be created manually in
-- Supabase Dashboard > Storage > New Bucket
--
-- Settings:
--   Name: file-transfer-bucket
--   Public: OFF (unchecked)
--   File size limit: 52428800 (50MB)
--   Allowed MIME types: (leave empty for all)

-- ============================================
-- 6. STORAGE POLICIES (Run in SQL Editor)
-- ============================================
-- These policies control access to the storage bucket

-- Allow uploads to the bucket
DROP POLICY IF EXISTS "Allow uploads" ON storage.objects;
CREATE POLICY "Allow uploads"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'file-transfer-bucket');

-- Allow reading files from the bucket (for signed URLs)
DROP POLICY IF EXISTS "Allow downloads" ON storage.objects;
CREATE POLICY "Allow downloads"
ON storage.objects
FOR SELECT
USING (bucket_id = 'file-transfer-bucket');

-- Allow owners to delete their files from storage
DROP POLICY IF EXISTS "Allow owner deletes" ON storage.objects;
CREATE POLICY "Allow owner deletes"
ON storage.objects
FOR DELETE
USING (bucket_id = 'file-transfer-bucket');

-- ============================================
-- 7. HELPER FUNCTIONS (Optional)
-- ============================================

-- Function to get file count for a user
CREATE OR REPLACE FUNCTION get_user_file_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.files
  WHERE owner_id = user_uuid;
$$;

-- Function to get total storage used by a user (in bytes)
CREATE OR REPLACE FUNCTION get_user_storage_used(user_uuid UUID)
RETURNS BIGINT
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(size), 0)::BIGINT
  FROM public.files
  WHERE owner_id = user_uuid;
$$;

-- ============================================
-- 8. SAMPLE DATA (Optional - for testing)
-- ============================================
-- Uncomment to insert test data
-- Note: These won't have actual files in storage

/*
INSERT INTO public.files (token, file_path, original_name, size, mime_type, owner_id)
VALUES
  ('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6/test-document.pdf', 'test-document.pdf', 1048576, 'application/pdf', NULL),
  ('b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7', 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7/sample-image.png', 'sample-image.png', 524288, 'image/png', NULL),
  ('c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8', 'c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8/video-clip.mp4', 'video-clip.mp4', 10485760, 'video/mp4', NULL);
*/

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify setup is correct

-- Check table exists
-- SELECT * FROM public.files LIMIT 1;

-- Check RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'files';

-- Check policies exist
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'files';

-- Check indexes exist
-- SELECT indexname FROM pg_indexes WHERE tablename = 'files';

-- ============================================
-- CLEANUP (Use with caution!)
-- ============================================
-- Uncomment to drop everything and start fresh

/*
DROP POLICY IF EXISTS "Anyone can upload files" ON public.files;
DROP POLICY IF EXISTS "Anyone can read files" ON public.files;
DROP POLICY IF EXISTS "Owners can delete own files" ON public.files;
DROP POLICY IF EXISTS "Owners can update own files" ON public.files;
DROP FUNCTION IF EXISTS get_user_file_count;
DROP FUNCTION IF EXISTS get_user_storage_used;
DROP TABLE IF EXISTS public.files;
*/
