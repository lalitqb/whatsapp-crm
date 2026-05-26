"use client"

import { use, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from "@/components/automations/automation-builder"
import type { AutomationTriggerType } from "@/types"

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const applyTemplate = searchParams.get("template") as "pickup_booking" | null
  const [initial, setInitial] = useState<BuilderInitial | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/automations/${id}`)
      if (!res.ok) {
        if (!cancelled) setError(`Failed to load (${res.status})`)
        return
      }
      const body = await res.json()
      if (cancelled) return
      let steps = fromServerSteps((body.steps ?? []) as ServerStepNode[])
      let trigger_type = body.automation.trigger_type as AutomationTriggerType
      let trigger_config = body.automation.trigger_config ?? {}
      let description = body.automation.description ?? ""

      if (applyTemplate === "pickup_booking") {
        const { buildInitialFromTemplate } = await import("@/lib/automations/templates")
        const built = buildInitialFromTemplate("pickup_booking")
        steps = built.steps as typeof steps
        trigger_type = built.trigger_type
        trigger_config = built.trigger_config
        if (!description) description = built.description
      }

      setInitial({
        id: body.automation.id,
        name: body.automation.name ?? "",
        description,
        trigger_type,
        trigger_config,
        is_active: !!body.automation.is_active,
        steps,
      })

      if (applyTemplate === "pickup_booking") {
        router.replace(`/automations/${id}/edit`)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, applyTemplate, router])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => router.push("/automations")}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Back to Automations
        </button>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    )
  }

  return <AutomationBuilder initial={initial} />
}
