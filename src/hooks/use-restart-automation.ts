"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

const DEFAULT_PICKUP_AUTOMATION_ID = "7a939c2b-8289-411d-8f46-b70069edb209";

export function useRestartAutomation(
  contactId: string | null | undefined,
  conversationId: string | null | undefined,
  automationId: string = DEFAULT_PICKUP_AUTOMATION_ID,
) {
  const [loading, setLoading] = useState(false);

  const restart = useCallback(async () => {
    if (!contactId || !conversationId) {
      toast.error("Select a conversation first");
      return false;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/inbox/restart-automation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contactId,
          conversation_id: conversationId,
          automation_id: automationId,
        }),
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
