'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Copy,
  Loader2,
  Plug,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { NotificationLogsPanel } from '@/components/settings/notification-logs-panel';

interface IntegrationConfig {
  endpoint: string;
  currentUserId: string;
  apiKeyConfigured: boolean;
  userIdConfigured: boolean;
  userIdMatchesSession: boolean;
  whatsappConfigured: boolean;
  envVars: { apiKey: string; userId: string };
}

const EXAMPLE_PAYLOAD = {
  customerPhone: '917903949014',
  template: 'laundry_order_ready',
  variables: {
    customer_name: 'Lalit',
    order_id: 'LD1234',
  },
  variableOrder: ['customer_name', 'order_id'],
};

const EXAMPLE_EVENTS = [
  {
    event: 'order_pickup',
    template: 'laundry_order_ready',
    description: 'Order ready for customer pickup',
  },
  {
    event: 'order_delivered',
    template: 'order_delivered',
    description: 'Order delivered to customer',
  },
  {
    event: 'schedule_order',
    template: 'schedule_order',
    description: 'Scheduled order confirmation',
  },
];

function StatusRow({
  ok,
  label,
  hint,
}: {
  ok: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="size-4 text-violet-400 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
      )}
      <div>
        <span className={ok ? 'text-slate-200' : 'text-red-300'}>{label}</span>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function CodeBlock({
  label,
  code,
  onCopy,
}: {
  label: string;
  code: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="h-7 text-slate-400 hover:text-white"
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-4 text-xs text-slate-300 font-mono leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

export function IntegrationsApiPanel() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<IntegrationConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/notifications/config');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load config');
        if (!cancelled) setConfig(data);
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Failed to load integration settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const payloadJson = useMemo(
    () => JSON.stringify(EXAMPLE_PAYLOAD, null, 2),
    [],
  );

  const curlExample = useMemo(() => {
    const endpoint = config?.endpoint ?? 'https://your-domain.com/api/v1/notifications/send';
    return `curl -X POST '${endpoint}' \\
  -H 'Authorization: Bearer YOUR_NOTIFICATION_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(EXAMPLE_PAYLOAD)}'`;
  }, [config?.endpoint]);

  const ready =
    config?.apiKeyConfigured &&
    config?.userIdConfigured &&
    config?.userIdMatchesSession &&
    config?.whatsappConfigured;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Notifications API</h2>
        <p className="text-sm text-slate-400 mt-1">
          Let external apps (order systems, laundry software, etc.) send WhatsApp
          template messages through your connected WhatsApp Business account.
        </p>
      </div>

      {!ready && config && (
        <Alert className="bg-amber-950/40 border-amber-600/40">
          <AlertTriangle className="size-4 text-amber-400" />
          <AlertTitle className="text-amber-200">Setup incomplete</AlertTitle>
          <AlertDescription className="text-amber-100/80 text-sm">
            Complete the checklist below before integrators call this API.
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Plug className="size-4 text-violet-400" />
            Setup checklist
          </CardTitle>
          <CardDescription className="text-slate-400">
            Server environment variables (restart{' '}
            <code className="text-slate-300">npm run dev</code> after changes)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <p className="text-xs text-slate-400">
              Put this in <code className="text-slate-300">.env.local</code> as{' '}
              <code className="text-violet-300">NOTIFICATION_API_USER_ID</code>{' '}
              (the account that owns WhatsApp Config in this CRM):
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-sm text-white break-all">
                {config?.currentUserId ?? '—'}
              </code>
              {config?.currentUserId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-700 shrink-0"
                  onClick={() =>
                    copyText(config.currentUserId, 'User ID')
                  }
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              )}
            </div>
          </div>
          <StatusRow
            ok={Boolean(config?.whatsappConfigured)}
            label="WhatsApp connected in this CRM account"
            hint="Settings → WhatsApp Config"
          />
          <StatusRow
            ok={Boolean(config?.apiKeyConfigured)}
            label={`${config?.envVars.apiKey ?? 'NOTIFICATION_API_KEY'} is set on the server`}
            hint="Shared secret integrators send as Bearer token"
          />
          <StatusRow
            ok={Boolean(config?.userIdConfigured)}
            label={`${config?.envVars.userId ?? 'NOTIFICATION_API_USER_ID'} is set on the server`}
            hint="Supabase user UUID that owns the WhatsApp config"
          />
          <StatusRow
            ok={Boolean(config?.userIdMatchesSession)}
            label="NOTIFICATION_API_USER_ID matches your logged-in user"
            hint={
              config?.userIdConfigured && !config?.userIdMatchesSession
                ? 'Set NOTIFICATION_API_USER_ID to your account UUID (see Profile or Supabase Auth)'
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">API endpoint</CardTitle>
          <CardDescription className="text-slate-400">
            <Badge variant="outline" className="border-slate-600 text-slate-300 mr-2">
              POST
            </Badge>
            JSON body. Not the same URL as Meta&apos;s inbound webhook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock
            label="URL"
            code={config?.endpoint ?? '/api/v1/notifications/send'}
            onCopy={() =>
              copyText(config?.endpoint ?? '', 'Endpoint URL')
            }
          />

          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Authentication
            </span>
            <p className="text-sm text-slate-300">
              Send your API key in either header (configured in server{' '}
              <code className="text-violet-300">.env.local</code>, never shown in
              the browser):
            </p>
            <pre className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300 font-mono">
              {`Authorization: Bearer YOUR_NOTIFICATION_API_KEY\n# or\nX-API-Key: YOUR_NOTIFICATION_API_KEY`}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Request body</CardTitle>
          <CardDescription className="text-slate-400">
            Templates must be <strong className="text-slate-200">Approved</strong>{' '}
            on Meta. Use <code className="text-slate-300">variableOrder</code> to
            map names to Meta placeholders {'{{1}}'}, {'{{2}}'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            label="JSON payload"
            code={payloadJson}
            onCopy={() => copyText(payloadJson, 'Payload')}
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Example events</CardTitle>
          <CardDescription className="text-slate-400">
            Create matching templates in Settings → Templates (or Meta), then use
            the same <code className="text-slate-300">template</code> name in the
            API call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {EXAMPLE_EVENTS.map((e) => (
              <li
                key={e.event}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2"
              >
                <span className="font-medium text-white">{e.event}</span>
                <span className="text-slate-500">→</span>
                <code className="text-violet-300">{e.template}</code>
                <span className="text-slate-500 text-xs w-full sm:w-auto">
                  {e.description}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">cURL example</CardTitle>
          <CardDescription className="text-slate-400">
            Replace <code className="text-slate-300">YOUR_NOTIFICATION_API_KEY</code>{' '}
            with the value from your server env.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            label="Terminal"
            code={curlExample}
            onCopy={() => copyText(curlExample, 'cURL command')}
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Success response</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-4 text-xs text-slate-300 font-mono">
{`{
  "success": true,
  "messageId": "wamid....",
  "phone": "917903949014",
  "template": "laundry_order_ready",
  "language": "en_US",
  "logId": "uuid-of-row-in-notification_logs"
}`}
          </pre>
        </CardContent>
      </Card>

      <NotificationLogsPanel />
    </div>
  );
}
