-- Guided pickup booking conversations (one active session per contact per flow).
CREATE TABLE IF NOT EXISTS booking_conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  flow_type TEXT NOT NULL DEFAULT 'pickup_acquisition',
  step TEXT NOT NULL,
  customer_type TEXT NOT NULL CHECK (customer_type IN ('existing', 'new')),
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, contact_id, flow_type)
);

CREATE INDEX IF NOT EXISTS idx_booking_sessions_contact
  ON booking_conversation_sessions(contact_id);

CREATE INDEX IF NOT EXISTS idx_booking_sessions_user_step
  ON booking_conversation_sessions(user_id, step);

ALTER TABLE booking_conversation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own booking sessions" ON booking_conversation_sessions;
CREATE POLICY "Users manage own booking sessions" ON booking_conversation_sessions
  FOR ALL USING (auth.uid() = user_id);
