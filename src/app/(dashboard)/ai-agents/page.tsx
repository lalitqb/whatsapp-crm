'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bot, Loader2, Plus, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface AgentSummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  business_name: string | null;
  languages: string[];
  updated_at: string;
}

export default function AiAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [openAiConfigured, setOpenAiConfigured] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/ai/agents');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setAgents(data.agents ?? []);
      setOpenAiConfigured(!!data.openAiConfigured);
      setMigrationRequired(!!data.migrationRequired);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load failed');
      setAgents([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createEmeraldWash() {
    setCreating(true);
    try {
      const res = await fetch('/api/ai/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'emeraldwash' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Create failed');
      toast.success('Emerald Wash agent created');
      router.push(`/ai-agents/${data.agent.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function toggleEnabled(agent: AgentSummary, enabled: boolean) {
    const res = await fetch(`/api/ai/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      toast.error('Could not update agent');
      return;
    }
    load();
  }

  if (agents === null) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="size-7 text-violet-400" />
            AI Agents
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Bilingual WhatsApp bots for support, sales, and booking — trained on
            your knowledge and connected to external APIs.
          </p>
        </div>
        <Button
          onClick={createEmeraldWash}
          disabled={creating || migrationRequired}
          className="bg-violet-600 hover:bg-violet-500"
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin mr-1" />
          ) : (
            <Plus className="size-4 mr-1" />
          )}
          Create Emerald Wash agent
        </Button>
      </div>

      {migrationRequired && (
        <Alert className="border-amber-800/60 bg-amber-950/30">
          <AlertTitle className="text-amber-200">Database migration</AlertTitle>
          <AlertDescription className="text-amber-100/80 text-sm">
            Run{' '}
            <code className="text-amber-200">
              supabase/migrations/012_ai_agents.sql
            </code>{' '}
            in Supabase SQL Editor.
          </AlertDescription>
        </Alert>
      )}

      {!openAiConfigured && (
        <Alert className="border-slate-700 bg-slate-900">
          <Sparkles className="size-4 text-violet-400" />
          <AlertDescription className="text-slate-300 text-sm">
            Set <code className="text-violet-300">OPENAI_API_KEY</code> in{' '}
            <code className="text-violet-300">.env.local</code> to power agents
            (e.g. gpt-4o-mini).
          </AlertDescription>
        </Alert>
      )}

      {agents.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 border-dashed">
          <CardHeader>
            <CardTitle className="text-white">No agents yet</CardTitle>
            <CardDescription className="text-slate-400">
              Start with the pre-built{' '}
              <strong className="text-slate-200">Emerald Wash</strong> template for
              emeraldwash.in — English & Hindi, pickup booking tools, and laundry
              FAQs included.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={createEmeraldWash}
              disabled={creating || migrationRequired}
              className="bg-violet-600"
            >
              <Plus className="size-4 mr-1" />
              Create Emerald Wash agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Card className="bg-slate-900 border-slate-700 h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-white text-lg">
                      {agent.name}
                    </CardTitle>
                    {agent.enabled ? (
                      <Badge className="bg-emerald-950 text-emerald-300 border-emerald-800">
                        Live
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-600">
                        Draft
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-slate-400 line-clamp-2">
                    {agent.description ??
                      agent.business_name ??
                      'WhatsApp AI agent'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500">
                    Languages: {(agent.languages ?? []).join(', ')}
                  </p>
                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={agent.enabled}
                        onCheckedChange={(v) => toggleEnabled(agent, v)}
                      />
                      <span className="text-xs text-slate-400">Enabled</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-600"
                      onClick={() => router.push(`/ai-agents/${agent.id}`)}
                    >
                      <Pencil className="size-3 mr-1" />
                      Configure
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
