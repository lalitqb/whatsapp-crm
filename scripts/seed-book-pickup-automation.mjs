/**
 * Book Pickup is configured in the UI, not via this script.
 *
 * 1. Automations → Workflow templates → "Pickup booking (step-by-step)"
 *    OR edit Book Pickup → Templates → Load pickup booking template → Save
 *
 * 2. Edit each HTTP Request block with your real API URL and API key.
 * 3. Set keyword trigger (e.g. Book Pickup, book_pickup).
 * 4. Apply migration 015_automation_flow_sessions.sql in Supabase.
 */
console.log(`
Book Pickup is built in the automation editor (no seed required).

Steps:
  1. Open https://your-app/automations
  2. Use template "Pickup booking (step-by-step)" OR edit Book Pickup and click
     "Load pickup booking template" in the builder.
  3. Customize messages, URLs, and keywords — then Save.
  4. Run migration: supabase/migrations/015_automation_flow_sessions.sql
`)
