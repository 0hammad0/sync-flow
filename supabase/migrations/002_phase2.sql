-- Phase 2: Add encryption, expiry, and download tracking fields

-- Add new columns to files table
ALTER TABLE files
ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS max_downloads INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0;

-- Index for expiry cleanup queries
CREATE INDEX IF NOT EXISTS idx_files_expires_at
ON files(expires_at) WHERE expires_at IS NOT NULL;

-- Function for atomic download count increment
CREATE OR REPLACE FUNCTION increment_download_count(file_token VARCHAR(32))
RETURNS INTEGER AS $$
DECLARE new_count INTEGER;
BEGIN
  UPDATE files SET download_count = download_count + 1
  WHERE token = file_token
  RETURNING download_count INTO new_count;
  RETURN new_count;
END;
$$ LANGUAGE plpgsql;
