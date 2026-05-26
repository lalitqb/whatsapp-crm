"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"

import {
  AutomationBuilder,
  type BuilderInitial,
} from "@/components/automations/automation-builder"
import { buildInitialFromTemplate, getTemplate, type TemplateSlug } from "@/lib/automations/templates"
import type { AutomationTriggerType } from "@/types"

export default function NewAutomationPage() {
  const params = useSearchParams()
  const template = params.get("template") as TemplateSlug | null

  const initial: BuilderInitial = useMemo(() => {
    if (template && getTemplate(template)) {
      const fromTemplate = buildInitialFromTemplate(template)
      return {
        ...fromTemplate,
        is_active: false,
      }
    }
    return {
      name: "",
      description: "",
      trigger_type: "new_message_received" as AutomationTriggerType,
      trigger_config: {},
      is_active: false,
      steps: [],
    }
  }, [template])

  return <AutomationBuilder initial={initial} />
}
