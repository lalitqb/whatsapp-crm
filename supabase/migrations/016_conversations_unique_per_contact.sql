-- One inbox thread per contact per tenant. Run only after removing duplicate rows:
--
--   SELECT user_id, contact_id, COUNT(*) FROM conversations
--   GROUP BY user_id, contact_id HAVING COUNT(*) > 1;
--
-- Keep the row with the latest last_message_at; delete the others (or merge messages first).

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_contact_unique
  ON conversations (user_id, contact_id);
