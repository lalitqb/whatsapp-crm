"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Loader2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRestartAutomation } from "@/hooks/use-restart-automation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Automation } from "@/types";

const DEFAULT_PICKUP_AUTOMATION_ID = "7a939c2b-8289-411d-8f46-b70069edb209";

interface AutomationRestartPanelProps {
  contactId: string;
  conversationId: string;
}

export function AutomationRestartPanel({
  contactId,
  conversationId,
}: AutomationRestartPanelProps) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationId, setAutomationId] = useState(DEFAULT_PICKUP_AUTOMATION_ID);
  const { restart, loading } = useRestartAutomation(
    contactId,
    conversationId,
    automationId,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/automations");
        if (!res.ok) return;
        const data = await res.json();
        const list = (data.automations ?? []) as Automation[];
        if (cancelled) return;
        setAutomations(list.filter((a) => a.is_active));
        const pickup = list.find(
          (a) =>
            a.is_active &&
            /pickup|booking/i.test(a.name ?? ""),
        );
        if (pickup) setAutomationId(pickup.id);
        else if (list[0]?.is_active) setAutomationId(list[0].id);
      } catch {
        // keep default id
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500">
        <Workflow className="h-3 w-3" />
        Automation
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Clears the paused flow session and runs the automation from step 1
        (customer lookup → booking).
      </p>
      {automations.length > 1 && (
        <Select
          value={automationId}
          onValueChange={(id) => id && setAutomationId(id)}
        >
          <SelectTrigger className="mt-2 h-8 border-slate-700 bg-slate-900 text-xs text-white">
            <SelectValue placeholder="Select automation" />
          </SelectTrigger>
          <SelectContent className="border-slate-700 bg-slate-800">
            {automations.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs text-slate-200">
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 w-full border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
        onClick={() => void restart()}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
        )}
        Restart booking flow
      </Button>
    </div>
  );
}
