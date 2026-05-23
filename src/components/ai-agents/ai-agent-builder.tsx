'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Bot,
  Loader2,
  Save,
  Sparkles,
  MessageSquare,
  Wrench,
  BookOpen,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export interface AiAgentRecord {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  model: string;
  system_prompt: string;
  knowledge_base: string | null;
  languages: string[];
  tools_config: Array<{ id: string; enabled?: boolean; label?: string }>;
  handoff_phrases: string[];
  pause_when_assigned: boolean;
  max_history_messages: number;
  reply_to_non_text: boolean;
  business_name: string | null;
  business_website: string | null;
  booking_api_url: string | null;
  booking_api_key: string | null;
}

interface LogRow {
  id: string;
  customer_message: string | null;
  agent_reply: string | null;
  error: string | null;
  created_at: string;
}

interface AiAgentBuilderProps {
  agentId: string;
  openAiConfigured: boolean;
}

export function AiAgentBuilder({
  agentId,
  openAiConfigured,
}: AiAgentBuilderProps) {
  const router = useRouter();
  const [agent, setAgent] = useState<AiAgentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testMessage, setTestMessage] = useState(
    'Hi, I need pickup tomorrow in 560001. Dry clean 2 shirts.',
  );
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/agents/${agentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setAgent(data.agent);
      const logRes = await fetch(`/api/ai/agents/${agentId}/logs`);
      const logData = await logRes.json();
      if (logRes.ok) setLogs(logData.logs ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!agent) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setAgent(data.agent);
      toast.success('Agent saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestReply(null);
    try {
      const res = await fetch(`/api/ai/agents/${agentId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Test failed');
      setTestReply(data.reply);
      if (data.toolCalls?.length) {
        toast.message(`Used ${data.toolCalls.length} tool(s)`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  function patch(partial: Partial<AiAgentRecord>) {
    setAgent((a) => (a ? { ...a, ...partial } : a));
  }

  function toggleLanguage(lang: string) {
    if (!agent) return;
    const langs = agent.languages ?? [];
    const next = langs.includes(lang)
      ? langs.filter((l) => l !== lang)
      : [...langs, lang];
    patch({ languages: next.length ? next : ['en'] });
  }

  function toggleTool(id: string) {
    if (!agent) return;
    const tools = agent.tools_config ?? [];
    patch({
      tools_config: tools.map((t) =>
        t.id === id ? { ...t, enabled: !t.enabled } : t,
      ),
    });
  }

  if (loading || !agent) {
    return (
      <div className="flex justify-center py-20 text-slate-400">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="size-7 text-violet-400" />
            {agent.name}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {agent.description ?? 'WhatsApp AI agent'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="enabled" className="text-slate-300 text-sm">
              Live on WhatsApp
            </Label>
            <Switch
              id="enabled"
              checked={agent.enabled}
              onCheckedChange={(v) => patch({ enabled: v })}
            />
          </div>
          <Button onClick={save} disabled={saving} className="bg-violet-600">
            {saving ? (
              <Loader2 className="size-4 animate-spin mr-1" />
            ) : (
              <Save className="size-4 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      {!openAiConfigured && (
        <Alert className="border-amber-800/60 bg-amber-950/30">
          <Sparkles className="size-4 text-amber-400" />
          <AlertTitle className="text-amber-200">OpenAI key required</AlertTitle>
          <AlertDescription className="text-amber-100/80 text-sm">
            Add <code className="text-amber-200">OPENAI_API_KEY</code> to{' '}
            <code className="text-amber-200">.env.local</code> and restart the dev
            server. The agent will not reply on WhatsApp until this is set.
          </AlertDescription>
        </Alert>
      )}

      {agent.enabled && (
        <Alert className="border-violet-800/50 bg-violet-950/20">
          <MessageSquare className="size-4 text-violet-400" />
          <AlertDescription className="text-slate-300 text-sm">
            When enabled, this agent replies to inbound WhatsApp text messages
            automatically (after your webhook receives them). Replies appear in
            Inbox as <Badge variant="outline">bot</Badge> messages.
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Globe className="size-4" /> Business
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-400">Name</Label>
            <Input
              value={agent.business_name ?? ''}
              onChange={(e) => patch({ business_name: e.target.value })}
              className="bg-slate-950 border-slate-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400">Website</Label>
            <Input
              value={agent.business_website ?? ''}
              onChange={(e) => patch({ business_website: e.target.value })}
              className="bg-slate-950 border-slate-700"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-400">Agent display name</Label>
            <Input
              value={agent.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="bg-slate-950 border-slate-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400">Model</Label>
            <Input
              value={agent.model}
              onChange={(e) => patch({ model: e.target.value })}
              className="bg-slate-950 border-slate-700 font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400">Languages</Label>
            <div className="flex gap-2">
              {(['en', 'hi'] as const).map((lang) => (
                <Button
                  key={lang}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={
                    agent.languages?.includes(lang)
                      ? 'border-violet-500 text-violet-300'
                      : 'border-slate-600 text-slate-400'
                  }
                  onClick={() => toggleLanguage(lang)}
                >
                  {lang === 'en' ? 'English' : 'Hindi'}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Sparkles className="size-4" /> System prompt
          </CardTitle>
          <CardDescription className="text-slate-400">
            Personality, goals, and rules for the agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={agent.system_prompt}
            onChange={(e) => patch({ system_prompt: e.target.value })}
            rows={10}
            className="bg-slate-950 border-slate-700 font-mono text-sm"
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <BookOpen className="size-4" /> Knowledge base
          </CardTitle>
          <CardDescription className="text-slate-400">
            FAQs, pricing, service areas — the agent treats this as source of truth.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={agent.knowledge_base ?? ''}
            onChange={(e) => patch({ knowledge_base: e.target.value })}
            rows={14}
            className="bg-slate-950 border-slate-700 font-mono text-sm"
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Wrench className="size-4" /> Tools & booking API
          </CardTitle>
          <CardDescription className="text-slate-400">
            Connect your laundry booking backend, or leave URL empty to use demo
            responses for testing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-slate-400">Booking API base URL</Label>
            <Input
              placeholder="https://api.emeraldwash.in"
              value={agent.booking_api_url ?? ''}
              onChange={(e) => patch({ booking_api_url: e.target.value })}
              className="bg-slate-950 border-slate-700 font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400">Booking API key (optional)</Label>
            <Input
              type="password"
              value={agent.booking_api_key ?? ''}
              onChange={(e) => patch({ booking_api_key: e.target.value })}
              className="bg-slate-950 border-slate-700"
            />
          </div>
          <ul className="space-y-2">
            {(agent.tools_config ?? []).map((tool) => (
              <li
                key={tool.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2"
              >
                <div>
                  <span className="text-sm text-white">
                    {tool.label ?? tool.id}
                  </span>
                  <span className="block text-xs text-slate-500 font-mono">
                    {tool.id}
                  </span>
                </div>
                <Switch
                  checked={tool.enabled !== false}
                  onCheckedChange={() => toggleTool(tool.id)}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Behaviour</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-200">Pause when assigned to human</p>
              <p className="text-xs text-slate-500">
                Stop auto-replies if conversation has an assigned agent
              </p>
            </div>
            <Switch
              checked={agent.pause_when_assigned}
              onCheckedChange={(v) => patch({ pause_when_assigned: v })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400">
              Handoff phrases (comma-separated)
            </Label>
            <Input
              value={(agent.handoff_phrases ?? []).join(', ')}
              onChange={(e) =>
                patch({
                  handoff_phrases: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="bg-slate-950 border-slate-700"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Test chat</CardTitle>
          <CardDescription className="text-slate-400">
            Try English or Hindi before going live.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            rows={3}
            className="bg-slate-950 border-slate-700"
          />
          <Button
            type="button"
            variant="outline"
            onClick={runTest}
            disabled={testing || !openAiConfigured}
            className="border-slate-600"
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin mr-1" />
            ) : null}
            Send test
          </Button>
          {testReply && (
            <div className="rounded-lg border border-violet-800/40 bg-violet-950/20 p-4 text-sm text-slate-200 whitespace-pre-wrap">
              {testReply}
            </div>
          )}
        </CardContent>
      </Card>

      {logs.length > 0 && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Recent WhatsApp runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-slate-800 p-3 text-xs space-y-1"
              >
                <p className="text-slate-500">
                  {new Date(log.created_at).toLocaleString()}
                </p>
                <p className="text-slate-400">
                  <span className="text-violet-400">Customer:</span>{' '}
                  {log.customer_message}
                </p>
                {log.agent_reply && (
                  <p className="text-slate-300">
                    <span className="text-emerald-400">Bot:</span> {log.agent_reply}
                  </p>
                )}
                {log.error && (
                  <p className="text-red-400">Error: {log.error}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button
        type="button"
        variant="ghost"
        className="text-slate-400"
        onClick={() => router.push('/ai-agents')}
      >
        ← Back to agents
      </Button>
    </div>
  );
}
