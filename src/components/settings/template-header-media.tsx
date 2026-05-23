'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MessageTemplate } from '@/types';
import { isMediaHeaderType } from '@/lib/whatsapp/template-header-media';

interface TemplateHeaderMediaProps {
  template: MessageTemplate;
  onUpdated: () => void;
}

export function TemplateHeaderMedia({
  template,
  onUpdated,
}: TemplateHeaderMediaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!isMediaHeaderType(template.header_type)) {
    return null;
  }

  const kind = (template.header_type ?? 'image').toLowerCase();
  const accept =
    kind === 'video'
      ? 'video/mp4'
      : kind === 'document'
        ? 'application/pdf'
        : 'image/png,image/jpeg,image/webp';

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(
        `/api/whatsapp/templates/${template.id}/header-media`,
        { method: 'POST', body: form },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      toast.success(data.message ?? 'Header media saved');
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/whatsapp/templates/${template.id}/header-media`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Remove failed');
      toast.success('Header media removed');
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
          <ImageIcon className="size-3.5 text-violet-400" />
          Default {kind} header (Notifications API)
        </p>
        <div className="flex gap-1">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-slate-600"
            disabled={uploading || removing}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-3 animate-spin mr-1" />
            ) : (
              <Upload className="size-3 mr-1" />
            )}
            {template.header_media_url ? 'Replace' : 'Upload'}
          </Button>
          {template.header_media_url && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-red-400 hover:text-red-300"
              disabled={uploading || removing}
              onClick={handleRemove}
            >
              {removing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </Button>
          )}
        </div>
      </div>

      {template.header_media_url ? (
        <div className="flex items-start gap-3">
          {kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={template.header_media_url}
              alt=""
              className="h-16 w-24 rounded object-cover border border-slate-700"
            />
          )}
          <p className="text-[11px] text-slate-500 break-all flex-1">
            {template.header_media_filename ?? 'Uploaded file'}
            <span className="block text-emerald-500/90 mt-1">
              Used automatically when sending this template via the Notifications
              API — no headerMedia in the webhook body needed.
            </span>
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-amber-500/90">
          Upload the {kind} shown at the top of this template on WhatsApp. Stored
          in Supabase and sent to Meta on each notification.
        </p>
      )}
    </div>
  );
}
