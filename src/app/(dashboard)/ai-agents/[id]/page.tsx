'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AiAgentBuilder } from '@/components/ai-agents/ai-agent-builder';

export default function AiAgentEditPage() {
  const params = useParams();
  const id = params.id as string;
  const [openAiConfigured, setOpenAiConfigured] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/ai/agents')
      .then((r) => r.json())
      .then((d) => {
        setOpenAiConfigured(!!d.openAiConfigured);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return <AiAgentBuilder agentId={id} openAiConfigured={openAiConfigured} />;
}
