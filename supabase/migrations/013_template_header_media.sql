-- Default header media per template (Notifications API + broadcasts)

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS header_media_url TEXT,
  ADD COLUMN IF NOT EXISTS header_media_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS header_media_filename TEXT;

COMMENT ON COLUMN message_templates.header_media_url IS
  'Public HTTPS URL in Supabase Storage — sent as Meta template header media';
COMMENT ON COLUMN message_templates.header_media_storage_path IS
  'Path in template-headers bucket: {user_id}/{template_id}/...';

-- ============================================================
-- Storage bucket: template-headers (public read for Meta fetch)
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'template-headers',
  'template-headers',
  TRUE,
  16777216, -- 16 MB
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'video/mp4',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Template headers are publicly readable" ON storage.objects;
CREATE POLICY "Template headers are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'template-headers');

DROP POLICY IF EXISTS "Users can upload own template headers" ON storage.objects;
CREATE POLICY "Users can upload own template headers"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'template-headers'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own template headers" ON storage.objects;
CREATE POLICY "Users can update own template headers"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'template-headers'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own template headers" ON storage.objects;
CREATE POLICY "Users can delete own template headers"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'template-headers'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
