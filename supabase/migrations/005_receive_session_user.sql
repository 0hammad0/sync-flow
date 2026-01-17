-- Add receiver_id to receive_sessions table
-- This links received files to the logged-in user who initiated the receive

ALTER TABLE receive_sessions
ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for quick lookups by user
CREATE INDEX IF NOT EXISTS idx_receive_sessions_receiver
ON receive_sessions(receiver_id);

-- Comment for documentation
COMMENT ON COLUMN receive_sessions.receiver_id IS 'The user ID of the person receiving the file (if logged in)';
