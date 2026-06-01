-- Migration: 017_template_waba_id.sql
-- Add waba_id column to message_templates to allow isolating templates per WhatsApp Business Account (WABA).

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

-- Create an index on waba_id for fast querying
CREATE INDEX IF NOT EXISTS idx_message_templates_waba_id ON message_templates(waba_id);

-- Backfill waba_id for existing templates using the user's connected whatsapp_config
UPDATE message_templates
SET waba_id = (
  SELECT waba_id 
  FROM whatsapp_config 
  WHERE whatsapp_config.user_id = message_templates.user_id 
  LIMIT 1
)
WHERE waba_id IS NULL;
