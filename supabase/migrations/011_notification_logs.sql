-- Audit log for external Notifications API sends + Meta delivery webhooks

CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT,
  variables JSONB DEFAULT '{}'::jsonb,
  variable_order JSONB,
  request_payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  whatsapp_message_id TEXT,
  api_error TEXT,
  meta_error_code TEXT,
  meta_error_title TEXT,
  meta_error_message TEXT,
  meta_error_details TEXT,
  meta_status_payload JSONB,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user_created
  ON notification_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_logs_wamid
  ON notification_logs(whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification logs" ON notification_logs;
CREATE POLICY "Users can view own notification logs"
  ON notification_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON notification_logs;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
