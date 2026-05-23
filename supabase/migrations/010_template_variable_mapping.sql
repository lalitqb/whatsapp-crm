-- Maps friendly API variable names to Meta template placeholder indices.
-- Example for body "Hi {{1}}, order {{2}} is ready":
--   {"customer_name": 1, "order_id": 2}
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS variable_mapping JSONB;
