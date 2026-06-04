"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

export function useRestartAutomation(
  contactId: string | null | undefined,
  conversationId: string | null | undefined,
  // Pass an explicit automation ID only when you know the exact automation to
  // restart. When omitted the server resolves the best pickup/booking automation
  // for the current user automatically — this avoids cross-user ID mismatches.
  automationId?: string,
) {
  const [loading, setLoading] = useState(false);

  const restart = useCallback(async () => {
    if (!contactId || !conversationId) {
      toast.error("Select a conversation first");
      return false;
    }
    setLoading(true);
    try {
      const body: Record<string, string> = {
        contact_id: contactId,
        conversation_id: conversationId,
      };
      // Only include automation_id when the caller explicitly provides one.
      // Omitting it lets the server pick the right automation for the logged-in user.
      if (automationId) body.automation_id = automationId;

      const res = await fetch("/api/inbox/restart-automation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 503) {
          toast.error(
            data.error ??
              "Cannot reach Supabase. Check your connection and try again.",
          );
        } else if (res.status === 401) {
          toast.error("Session expired. Please sign in again.");
        } else {
          toast.error(data.error ?? "Could not restart automation");
        }
        return false;
      }
      toast.success("Booking flow restarted from step 1");
      return true;
    } catch {
      toast.error("Could not restart automation");
      return false;
    } finally {
      setLoading(false);
    }
  }, [automationId, contactId, conversationId]);

  return { restart, loading };
}
