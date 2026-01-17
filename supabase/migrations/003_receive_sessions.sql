-- Receive sessions for phone-to-PC transfers
CREATE TABLE IF NOT EXISTS receive_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token VARCHAR(32) UNIQUE NOT NULL,
  file_token VARCHAR(32) DEFAULT NULL,  -- Links to files.token when upload completes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes')
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_receive_sessions_token
ON receive_sessions(session_token);

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_receive_sessions_expires
ON receive_sessions(expires_at);

-- RLS policies
ALTER TABLE receive_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can create a session (for anonymous receive)
CREATE POLICY "Anyone can create receive sessions" ON receive_sessions
  FOR INSERT WITH CHECK (true);

-- Anyone can read sessions (needed to check status)
CREATE POLICY "Anyone can read receive sessions" ON receive_sessions
  FOR SELECT USING (true);

-- Anyone can update sessions (to link file after upload)
CREATE POLICY "Anyone can update receive sessions" ON receive_sessions
  FOR UPDATE USING (true);
