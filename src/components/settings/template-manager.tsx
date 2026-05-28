'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Loader2, RefreshCw, CloudUpload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { MessageTemplate } from '@/types';
import { TemplateHeaderMedia } from '@/components/settings/template-header-media';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

const statusColors: Record<string, string> = {
  Draft: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
  Pending: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  Approved: 'bg-violet-600/20 text-violet-400 border-violet-600/30',
  Rejected: 'bg-red-600/20 text-red-400 border-red-600/30',
};

export function TemplateManager() {
  const router = useRouter();
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    handleSyncFromMeta()
    fetchTemplates(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTemplates(userId: string) {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pull approved templates from Meta and upsert them into the local
   * catalog. After this runs, every local row is guaranteed to match
   * something Meta will actually accept on send — stops users getting
   * stuck on error #132001 "Template name does not exist".
   */
  async function submitTemplateToMeta(template: MessageTemplate) {
    const res = await fetch('/api/whatsapp/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: template.name,
        category: template.category,
        language: template.language?.trim() || 'en_US',
        body_text: template.body_text,
        header_type: template.header_type || null,
        header_content: template.header_content || null,
        footer_text: template.footer_text || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `Submit failed (HTTP ${res.status})`);
    }
    return data as { message?: string; status?: string };
  }

  async function handleSubmitToMeta(template: MessageTemplate) {
    if (!user) return;
    setSubmittingId(template.id);
    try {
      const data = await submitTemplateToMeta(template);
      toast.success(data.message || 'Template submitted to Meta');
      await fetchTemplates(user.id);
    } catch (err) {
      console.error('Submit to Meta error:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to submit template to Meta',
      );
    } finally {
      setSubmittingId(null);
    }
  }

  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      }
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
          (data.inserted || data.updated
            ? ` (${data.inserted} new, ${data.updated} updated)`
            : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        // Surface per-template failures so users don't trust a green
        // toast that hides silent drift.
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(`Failed to sync: ${preview.join(', ')}${suffix}`);
      }
      if (data.truncated) {
        toast.warning(
          'Hit Meta pagination cap — more templates may exist. Contact support if this persists.',
        );
      }
      await fetchTemplates(user.id);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to sync templates',
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete template');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Message Templates</h2>
          <p className="text-sm text-slate-400">
            Create templates here to submit them to Meta, then use &quot;Sync from
            Meta&quot; to refresh approval status. For templates with an image
            header, upload default media below — the Notifications API uses it
            automatically (no URL in each webhook call).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
            className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
            title="Pull approved templates from your Meta WhatsApp Business Account"
          >
            <RefreshCw
              className={`size-4 ${syncing ? 'animate-spin' : ''}`}
            />
            {syncing ? 'Syncing…' : 'Sync from Meta'}
          </Button>
          <Button
            onClick={() => router.push('/template/new')}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            <CloudUpload className="size-4" />
            New Template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-slate-400 text-sm">No templates yet.</p>
            <p className="text-slate-500 text-xs mt-1">Create your first message template to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => (
            <Card key={template.id} className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
              <CardContent className="flex items-start justify-between pt-4">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-white">{template.name}</h3>
                    <Badge
                      className={`text-xs border ${categoryColors[template.category] || ''}`}
                    >
                      {template.category}
                    </Badge>
                    <Badge
                      className={`text-xs border ${statusColors[template.status || 'Draft'] || ''}`}
                    >
                      {template.status || 'Draft'}
                    </Badge>
                    {template.language && (
                      <span className="text-xs text-slate-500 uppercase">{template.language}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 line-clamp-2">{template.body_text}</p>
                  {template.footer_text && (
                    <p className="text-xs text-slate-500 italic">{template.footer_text}</p>
                  )}
                  {template.status === 'Draft' && (
                    <p className="text-xs text-amber-500/90">
                      Local draft only — not on Meta yet. Submit to Meta or delete and use
                      &quot;Create on Meta&quot;.
                    </p>
                  )}
                  <TemplateHeaderMedia
                    template={template}
                    onUpdated={() => user && fetchTemplates(user.id)}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1 ml-2">
                  {template.status === 'Draft' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Submit this template to Meta"
                      onClick={() => handleSubmitToMeta(template)}
                      disabled={submittingId === template.id}
                      className="text-slate-400 hover:text-violet-400 hover:bg-violet-950/30"
                    >
                      {submittingId === template.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CloudUpload className="size-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(template.id)}
                    className="text-slate-400 hover:text-red-400 hover:bg-red-950/30"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </div>
  );
}
