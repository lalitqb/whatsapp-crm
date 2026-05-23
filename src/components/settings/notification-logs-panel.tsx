'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  Eye,
  Loader2,
  RefreshCw,
  Send,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export interface NotificationLogRow {
  id: string;
  customer_phone: string;
  template_name: string;
  template_language: string | null;
  variables: Record<string, string> | null;
  status: string;
  whatsapp_message_id: string | null;
  api_error: string | null;
  meta_error_code: string | null;
  meta_error_title: string | null;
  meta_error_message: string | null;
  meta_error_details: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'border-amber-600/50 text-amber-300 bg-amber-950/40',
    sent: 'border-blue-600/50 text-blue-300 bg-blue-950/40',
    delivered: 'border-emerald-600/50 text-emerald-300 bg-emerald-950/40',
    read: 'border-violet-600/50 text-violet-300 bg-violet-950/40',
    failed: 'border-red-600/50 text-red-300 bg-red-950/40',
  };
  const icons: Record<string, React.ReactNode> = {
    pending: <Loader2 className="size-3 animate-spin" />,
    sent: <Send className="size-3" />,
    delivered: <CheckCheck className="size-3" />,
    read: <Eye className="size-3" />,
    failed: <AlertCircle className="size-3" />,
  };
  return (
    <Badge
      variant="outline"
      className={`gap-1 capitalize ${styles[status] ?? 'border-slate-600 text-slate-300'}`}
    >
      {icons[status]}
      {status}
    </Badge>
  );
}

function formatWhen(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function errorSummary(log: NotificationLogRow): string | null {
  if (log.api_error) return log.api_error;
  if (log.meta_error_message) {
    const code = log.meta_error_code ? `#${log.meta_error_code} ` : '';
    const details = log.meta_error_details ? ` — ${log.meta_error_details}` : '';
    return `${code}${log.meta_error_message}${details}`;
  }
  return null;
}

export function NotificationLogsPanel() {
  const [logs, setLogs] = useState<NotificationLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationRequired, setMigrationRequired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/notifications/logs?limit=50');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load logs');
      setLogs(data.logs ?? []);
      setMigrationRequired(Boolean(data.migrationRequired));
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-white">Notification delivery log</CardTitle>
          <CardDescription className="text-slate-400">
            Every API send is stored here. Status updates (sent → delivered →
            read, or failed) come from Meta&apos;s webhook with error codes and
            details when delivery fails.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-600 shrink-0"
          onClick={() => load()}
          disabled={loading}
        >
          <RefreshCw className={`size-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {migrationRequired && (
          <Alert className="border-amber-800/60 bg-amber-950/30">
            <AlertTriangle className="size-4 text-amber-400" />
            <AlertTitle className="text-amber-200">Migration required</AlertTitle>
            <AlertDescription className="text-amber-100/80 text-sm">
              Run{' '}
              <code className="text-amber-200">
                supabase/migrations/011_notification_logs.sql
              </code>{' '}
              in the Supabase SQL Editor to start recording logs.
            </AlertDescription>
          </Alert>
        )}

        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="size-6 animate-spin mr-2" />
            Loading logs…
          </div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            No notification sends yet. Calls to{' '}
            <code className="text-slate-400">POST /api/v1/notifications/send</code>{' '}
            will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Time</TableHead>
                  <TableHead className="text-slate-400">Phone</TableHead>
                  <TableHead className="text-slate-400">Template</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Variables</TableHead>
                  <TableHead className="text-slate-400">Error / Meta ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const err = errorSummary(log);
                  const vars = log.variables
                    ? Object.entries(log.variables)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', ')
                    : '—';
                  return (
                    <TableRow
                      key={log.id}
                      className="border-slate-800 text-slate-300"
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatWhen(log.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.customer_phone}
                      </TableCell>
                      <TableCell>
                        <span className="text-violet-300 font-mono text-xs">
                          {log.template_name}
                        </span>
                        {log.template_language && (
                          <span className="block text-[10px] text-slate-500">
                            {log.template_language}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={log.status} />
                        <div className="mt-1 text-[10px] text-slate-500 space-y-0.5">
                          {log.sent_at && (
                            <div>Sent: {formatWhen(log.sent_at)}</div>
                          )}
                          {log.delivered_at && (
                            <div>Delivered: {formatWhen(log.delivered_at)}</div>
                          )}
                          {log.read_at && (
                            <div>Read: {formatWhen(log.read_at)}</div>
                          )}
                          {log.failed_at && (
                            <div>Failed: {formatWhen(log.failed_at)}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate" title={vars}>
                        {vars}
                      </TableCell>
                      <TableCell className="text-xs max-w-[220px]">
                        {err ? (
                          <span className="text-red-300" title={err}>
                            {err}
                          </span>
                        ) : log.whatsapp_message_id ? (
                          <span
                            className="font-mono text-[10px] text-slate-500 break-all"
                            title={log.whatsapp_message_id}
                          >
                            {log.whatsapp_message_id.slice(0, 24)}…
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
