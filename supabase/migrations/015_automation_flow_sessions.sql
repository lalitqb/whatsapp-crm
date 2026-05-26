-- Multi-turn automation flows (wait for customer reply between steps).
CREATE TABLE IF NOT EXISTS automation_flow_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  log_id UUID REFERENCES automation_logs(id) ON DELETE SET NULL,
  next_parent_step_id UUID,
  next_branch TEXT CHECK (next_branch IS NULL OR next_branch IN ('yes', 'no')),
  next_position INT NOT NULL DEFAULT 0,
  pending_reply_var TEXT,
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, contact_id, automation_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_sessions_contact
  ON automation_flow_sessions(contact_id);

ALTER TABLE automation_flow_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own flow sessions" ON automation_flow_sessions;
CREATE POLICY "Users manage own flow sessions" ON automation_flow_sessions
  FOR ALL USING (auth.uid() = user_id);
