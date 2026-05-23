-- WhatsApp AI agents (conversational bots with knowledge + external tools)

CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  system_prompt TEXT NOT NULL,
  knowledge_base TEXT,
  languages TEXT[] NOT NULL DEFAULT ARRAY['en', 'hi'],
  tools_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  handoff_phrases TEXT[] NOT NULL DEFAULT ARRAY['human', 'agent', 'manager', 'insaan', 'विशेषज्ञ'],
  pause_when_assigned BOOLEAN NOT NULL DEFAULT true,
  max_history_messages INTEGER NOT NULL DEFAULT 20,
  reply_to_non_text BOOLEAN NOT NULL DEFAULT false,
  business_name TEXT DEFAULT 'Emerald Wash',
  business_website TEXT DEFAULT 'https://emeraldwash.in',
  booking_api_url TEXT,
  booking_api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_user_enabled
  ON ai_agents(user_id, enabled);

CREATE TABLE IF NOT EXISTS ai_agent_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  inbound_message_id TEXT,
  customer_message TEXT,
  agent_reply TEXT,
  language_used TEXT,
  model TEXT,
  tool_calls JSONB,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_logs_inbound_dedup
  ON ai_agent_logs(inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_agent_created
  ON ai_agent_logs(agent_id, created_at DESC);

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own ai agents" ON ai_agents;
CREATE POLICY "Users manage own ai agents"
  ON ai_agents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own ai agent logs" ON ai_agent_logs;
CREATE POLICY "Users view own ai agent logs"
  ON ai_agent_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON ai_agents;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
