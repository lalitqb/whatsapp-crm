"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  Package,
  Globe,
  MessageCircleReply,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AutomationStepType,
  AutomationTriggerType,
  KeywordMatchTriggerConfig,
} from "@/types"
import { cn } from "@/lib/utils"
import {
  normalizeKeywordMatchConfig,
  normalizeKeywordMatchConfigRecord,
  parseKeywordsInput,
} from "@/lib/automations/trigger-config"
import {
  AUTOMATION_TEMPLATES,
  buildInitialFromTemplate,
  TEMPLATE_SLUGS,
  type TemplateSlug,
} from "@/lib/automations/templates"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: "Send Message", icon: MessageSquare, border: "border-l-violet-500" },
  send_template: { label: "Send Template", icon: FileText, border: "border-l-violet-500" },
  add_tag: { label: "Add Tag", icon: Tag, border: "border-l-violet-500" },
  remove_tag: { label: "Remove Tag", icon: TagIcon, border: "border-l-violet-500" },
  assign_conversation: { label: "Assign Conversation", icon: UserCheck, border: "border-l-violet-500" },
  update_contact_field: { label: "Update Contact Field", icon: PencilLine, border: "border-l-violet-500" },
  create_deal: { label: "Create Deal", icon: Briefcase, border: "border-l-violet-500" },
  wait: { label: "Wait", icon: Hourglass, border: "border-l-slate-500" },
  condition: { label: "Condition (If/Else)", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { label: "Send Webhook", icon: Webhook, border: "border-l-violet-500" },
  http_request: { label: "HTTP Request", icon: Globe, border: "border-l-sky-500" },
  wait_for_reply: {
    label: "Wait for Reply",
    icon: MessageCircleReply,
    border: "border-l-cyan-500",
  },
  start_pickup_booking: {
    label: "Start Pickup Booking",
    icon: Package,
    border: "border-l-emerald-500",
  },
  close_conversation: { label: "Close Conversation", icon: CircleSlash, border: "border-l-violet-500" },
}

const DEFAULT_STEP_META: StepMeta = {
  label: "Unknown step",
  icon: MessageSquare,
  border: "border-l-slate-500",
}

function getStepMeta(stepType: string): StepMeta {
  return STEP_META[stepType as AutomationStepType] ?? {
    ...DEFAULT_STEP_META,
    label: stepType.replace(/_/g, " "),
  }
}

const STEP_GROUPS: { label: string; types: AutomationStepType[] }[] = [
  {
    label: "Messages",
    types: ["send_message", "send_template"],
  },
  {
    label: "Conversation",
    types: ["wait_for_reply", "wait", "condition", "close_conversation"],
  },
  {
    label: "CRM",
    types: [
      "add_tag",
      "remove_tag",
      "assign_conversation",
      "update_contact_field",
      "create_deal",
    ],
  },
  {
    label: "API & webhooks",
    types: ["http_request", "send_webhook"],
  },
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string; hint: string }[] = [
  { value: "new_message_received", label: "New Message Received", hint: "Any incoming message" },
  {
    value: "first_inbound_message",
    label: "First Message from Contact",
    hint: "First time this contact ever messages you (works for manually-added contacts too)",
  },
  { value: "keyword_match", label: "Keyword Match", hint: "Message contains specific keyword(s)" },
  { value: "new_contact_created", label: "New Contact Created", hint: "When a contact is auto-created from an incoming message" },
  { value: "conversation_assigned", label: "Conversation Assigned", hint: "When assigned to an agent" },
  { value: "tag_added", label: "Tag Added", hint: "When a tag is added to a contact" },
  { value: "time_based", label: "Time-Based", hint: "On a recurring schedule" },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", method: "POST", headers: {}, body_template: "" }
    case "http_request":
      return {
        method: "GET",
        url: "",
        headers: {},
        body_template: "",
        store_as: "api_response",
      }
    case "wait_for_reply":
      return { save_reply_to: "" }
    case "close_conversation":
      return {}
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** Flushes keyword trigger text → config before save (if user didn't blur the field). */
  const flushKeywordConfigRef = useRef<(() => void) | null>(null)

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
    }
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  function loadWorkflowTemplate(slug: TemplateSlug) {
    const t = AUTOMATION_TEMPLATES[slug]
    const hasSteps = state.steps.length > 0
    if (
      hasSteps &&
      !window.confirm(
        `Replace current steps with "${t.name}"? Trigger settings will update too. This cannot be undone until you save.`,
      )
    ) {
      return
    }
    const built = buildInitialFromTemplate(slug)
    setState((s) => ({
      ...s,
      name: s.name.trim() ? s.name : built.name,
      description: s.description.trim() ? s.description : built.description,
      trigger_type: built.trigger_type,
      trigger_config: built.trigger_config,
      steps: built.steps as BuilderStep[],
    }))
    toast.success(`Loaded "${t.name}" — edit URLs, messages, and keywords, then Save.`)
  }

  const usesLegacyPickupBlock = hasLegacyPickupStep(state.steps)

  async function save() {
    setSaving(true)
    try {
      flushKeywordConfigRef.current?.()
      const trigger_config =
        state.trigger_type === "keyword_match"
          ? normalizeKeywordMatchConfig(state.trigger_config)
          : state.trigger_config

      const payload = {
        name: state.name || "Untitled automation",
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          })
        } else {
          toast.error(body?.error ?? "Save failed")
        }
        return
      }
      toast.success(isEditing ? "Automation saved" : "Automation created")
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          aria-label="Back to automations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder="Untitled automation"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-white placeholder:text-slate-500 focus:bg-slate-800 focus:outline-none sm:text-base"
        />
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 text-xs text-slate-200 hover:bg-slate-700">
            Templates
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-80 min-w-64 overflow-y-auto border-slate-700 bg-slate-900"
          >
            {TEMPLATE_SLUGS.map((slug) => {
              const t = AUTOMATION_TEMPLATES[slug]
              return (
                <DropdownMenuItem key={slug} onClick={() => loadWorkflowTemplate(slug)}>
                  <div>
                    <div className="font-medium text-white">{t.name}</div>
                    <div className="text-[11px] text-slate-400">{t.description}</div>
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">Active</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label="Active"
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-violet-600 text-white hover:bg-violet-700"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? "Save" : "Save Draft"}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,#1e293b_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-0 px-4 py-10">
          {usesLegacyPickupBlock && (
            <div className="z-10 mb-4 w-full max-w-[400px] rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <p className="font-medium">Legacy single-step pickup action</p>
              <p className="mt-1 text-xs text-amber-200/90">
                This automation uses one bundled block. Load the{" "}
                <strong>Pickup booking (step-by-step)</strong> template to get separate
                blocks for each message, wait step, condition, and HTTP call — all editable.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3 bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => loadWorkflowTemplate("pickup_booking")}
              >
                Load pickup booking template
              </Button>
            </div>
          )}
          <TriggerCard
            type={state.trigger_type}
            config={state.trigger_config}
            onTypeChange={(t) => {
              patchTop("trigger_type", t)
              if (t === "keyword_match") {
                patchTop(
                  "trigger_config",
                  normalizeKeywordMatchConfigRecord(state.trigger_config),
                )
              }
            }}
            onConfigChange={(c) => patchTop("trigger_config", c)}
            registerKeywordFlush={(fn) => {
              flushKeywordConfigRef.current = fn
            }}
          />
          <StepList
            steps={state.steps}
            parentPath={[]}
            parentScope={{ kind: "root" }}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            updateStep={updateStep}
            addStepAt={addStepAt}
            deleteStepAt={deleteStepAt}
            moveStepAt={moveStepAt}
          />
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
  registerKeywordFlush,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  registerKeywordFlush?: (flush: (() => void) | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-slate-800 border-l-4 border-l-blue-500 bg-slate-900 shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">Trigger</div>
            <div className="truncate text-sm font-medium text-white">
              {TRIGGER_OPTIONS.find((o) => o.value === type)?.label ?? type}
            </div>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-slate-800 px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Trigger type
              </label>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {TRIGGER_OPTIONS.find((o) => o.value === type)?.hint}
              </p>
            </div>
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
                registerFlush={registerKeywordFlush}
              />
            )}
            {type === "tag_added" && (
              <Input
                placeholder="Tag id"
                value={(config.tag_id as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ ...config, tag_id: e.target.value })
                }
                className="bg-slate-800 text-white"
              />
            )}
            {type === "time_based" && (
              <Input
                placeholder="Cron expression or HH:mm"
                value={(config.schedule as string) ?? ""}
                onChange={(e) =>
                  onConfigChange({ ...config, schedule: e.target.value })
                }
                className="bg-slate-800 text-white"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  onChange,
  registerFlush,
}: {
  config: KeywordMatchTriggerConfig
  onChange: (c: Record<string, unknown>) => void
  registerFlush?: (flush: (() => void) | null) => void
}) {
  const normalized = normalizeKeywordMatchConfig(
    config as unknown as Record<string, unknown>,
  )
  const [keywordText, setKeywordText] = useState(() =>
    normalized.keywords.join(", "),
  )
  const [matchType, setMatchType] = useState<"exact" | "contains">(
    normalized.match_type,
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // Resync when loading an existing automation from the API (not while typing).
  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    setKeywordText(normalized.keywords.join(", "))
    setMatchType(normalized.match_type)
  }, [normalized.keywords.join("\u0001"), normalized.match_type])

  function commit(nextText?: string, nextMatchType?: "exact" | "contains") {
    const keywords = parseKeywordsInput(nextText ?? keywordText)
    const mt = nextMatchType ?? matchType
    onChange({ keywords, match_type: mt })
    return { keywords, match_type: mt }
  }

  useEffect(() => {
    if (!registerFlush) return
    registerFlush(() => commit())
    return () => registerFlush(null)
  })

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          Keywords (comma-separated)
        </label>
        <Input
          ref={inputRef}
          value={keywordText}
          onChange={(e) => setKeywordText(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
              inputRef.current?.blur()
            }
          }}
          placeholder="pricing, quote, buy"
          className="bg-slate-800 text-white"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Separate with commas. Press Enter or click away to apply.
          {normalized.keywords.length > 0 && (
            <span className="text-slate-400">
              {" "}
              ({normalized.keywords.length} keyword
              {normalized.keywords.length === 1 ? "" : "s"} saved)
            </span>
          )}
        </p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          Match type
        </label>
        <select
          value={matchType}
          onChange={(e) => {
            const mt = e.target.value as "exact" | "contains"
            setMatchType(mt)
            commit(undefined, mt)
          }}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:outline-none"
        >
          <option value="contains">Contains</option>
          <option value="exact">Exact</option>
        </select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  parentScope: ParentScope
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
}

function StepList(props: StepListProps) {
  const { steps, parentPath, parentScope, ...rest } = props
  const inBranch = parentScope.kind === "branch"

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        inBranch ? "min-w-0 items-stretch" : "items-center",
      )}
    >
      <AddButton onPick={(t) => props.addStepAt(parentScope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          parentScope={parentScope}
          parentPath={parentPath}
          {...rest}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  parentScope: ParentScope
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const path: StepPath = [
    ...parentPath,
    parentScope.kind === "root"
      ? { kind: "root", index }
      : { kind: "branch", parentCid: parentScope.parentCid, branch: parentScope.branch, index },
  ]
  const meta = getStepMeta(step.step_type)
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  const inBranch = parentScope.kind === "branch"
  const hasBranches =
    isCondition &&
    ((step.branches?.yes?.length ?? 0) > 0 || (step.branches?.no?.length ?? 0) > 0)

  // Fixed 320px cards inside a 2-column condition grid caused horizontal overlap.
  // Branch steps use full column width; root condition with branches spans wider.
  const width = inBranch
    ? "w-full min-w-0 max-w-full"
    : isCondition
      ? hasBranches
        ? "w-full max-w-5xl"
        : "w-full max-w-[400px] sm:w-[400px]"
      : "w-full max-w-[320px] sm:w-80"

  return (
    <>
      <div className={cn("z-10 flex min-w-0 flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-slate-800 border-l-4 bg-slate-900 shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-600" aria-hidden />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-300">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                {isCondition
                  ? "Condition"
                  : step.step_type === "wait"
                  ? "Wait"
                  : step.step_type === "wait_for_reply"
                  ? "Wait for reply"
                  : "Action"}
              </div>
              <div className="truncate text-sm font-medium text-white">{meta.label}</div>
              <div className="truncate text-[11px] text-slate-500">{previewFor(step)}</div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div
              className="border-t border-slate-800 px-4 py-3"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <StepEditor
                step={step}
                onPatchConfig={(patch) =>
                  props.updateStep(path, (s) => ({
                    ...s,
                    step_config: { ...s.step_config, ...patch },
                  }))
                }
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label="Move up"
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label="Move down"
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} parentPath={path} {...props} />
        )}
      </div>

      <AddButton
        onPick={(t) => props.addStepAt(parentScope, index + 1, t)}
      />
    </>
  )
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath" | "parentScope">) {
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  const inBranch = parentPath.some((p) => p.kind === "branch")

  return (
    <div
      className={cn(
        "mt-3 grid w-full gap-6",
        inBranch ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
      )}
    >
      <BranchColumn label="Yes" color="text-violet-400">
        <StepList
          {...props}
          steps={yes}
          parentPath={parentPath}
          parentScope={{ kind: "branch", parentCid: step.cid, branch: "yes" }}
        />
      </BranchColumn>
      <BranchColumn label="No" color="text-rose-400">
        <StepList
          {...props}
          steps={no}
          parentPath={parentPath}
          parentScope={{ kind: "branch", parentCid: step.cid, branch: "no" }}
        />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 w-full flex-col items-stretch">
      <div className={cn("mb-2 text-center text-[11px] font-semibold uppercase", color)}>
        {label}
      </div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-slate-700" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-slate-700 bg-slate-950 text-slate-400 transition-colors hover:border-violet-500 hover:bg-violet-500/10 hover:text-violet-400 data-[popup-open]:border-violet-500 data-[popup-open]:bg-violet-500/20 data-[popup-open]:text-violet-400"
          aria-label="Add step"
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-slate-700 bg-slate-900"
        >
          {STEP_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {group.label}
              </div>
              {group.types.map((t) => {
                const stepMeta = getStepMeta(t)
                const Icon = stepMeta.icon
                return (
                  <DropdownMenuItem key={t} onClick={() => onPick(t)}>
                    <Icon className="h-4 w-4" />
                    {stepMeta.label}
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-slate-700" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// JSON object fields (headers) — local draft text so typing isn't reset
// ------------------------------------------------------------

function formatJsonObjectFieldValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value, null, 2)
  }
  return "{\n}"
}

function parseJsonObjectFieldValue(
  text: string,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: {} }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Must be a JSON object, e.g. {\"X-Api-Key\": \"secret\"}" }
    }
    return { ok: true, value: parsed as Record<string, string> }
  } catch {
    return { ok: false, error: "Invalid JSON — check commas and quotes" }
  }
}

function JsonObjectField({
  label,
  fieldKey,
  value,
  onChange,
  className,
}: {
  label: string
  /** Changes when switching steps so draft resets. */
  fieldKey: string
  value: unknown
  onChange: (headers: Record<string, string>) => void
  className?: string
}) {
  const [text, setText] = useState(() => formatJsonObjectFieldValue(value))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(formatJsonObjectFieldValue(value))
    setError(null)
  }, [fieldKey])

  function commit(): boolean {
    const result = parseJsonObjectFieldValue(text)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    onChange(result.value)
    setText(JSON.stringify(result.value, null, 2))
    return true
  }

  return (
    <FieldBlock label={label}>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText(formatJsonObjectFieldValue(value))
            setError(null)
          }
        }}
        className={cn("min-h-16 bg-slate-800 font-mono text-xs text-white", className)}
        spellCheck={false}
      />
      {error ? (
        <p className="mt-1 text-[11px] text-red-400">{error}</p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">Edit freely; changes apply when you click away.</p>
      )}
    </FieldBlock>
  )
}

/** Parse string headers before save / API. */
export function normalizeStepConfigForApi(
  stepType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (stepType !== "http_request" && stepType !== "send_webhook") return config
  const headers = config.headers
  if (headers == null) return config
  if (typeof headers === "object" && !Array.isArray(headers)) return config
  if (typeof headers === "string") {
    const result = parseJsonObjectFieldValue(headers)
    if (result.ok) return { ...config, headers: result.value }
  }
  return config
}

function normalizeStepsForApi(steps: BuilderStep[]): BuilderStep[] {
  return steps.map((s) => ({
    ...s,
    step_config: normalizeStepConfigForApi(s.step_type, s.step_config),
    branches: s.branches
      ? {
          yes: normalizeStepsForApi(s.branches.yes),
          no: normalizeStepsForApi(s.branches.no),
        }
      : undefined,
  }))
}

// ------------------------------------------------------------
// HTTP Request editor (local draft — reliable inside Yes/No branches)
// ------------------------------------------------------------

function HttpRequestStepEditor({
  stepCid,
  config,
  onPatchConfig,
}: {
  stepCid: string
  config: Record<string, unknown>
  onPatchConfig: (patch: Record<string, unknown>) => void
}) {
  const toDraft = (c: Record<string, unknown>) => ({
    method: (c.method as string) || "GET",
    url: (c.url as string) || "",
    headersText: formatJsonObjectFieldValue(c.headers),
    body_template: (c.body_template as string) || "",
    store_as: (c.store_as as string) || "",
  })

  const [draft, setDraft] = useState(() => toDraft(config))
  const [headersError, setHeadersError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(toDraft(config))
    setHeadersError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset draft only when switching steps
  }, [stepCid])

  function patch(partial: Partial<ReturnType<typeof toDraft>>) {
    const next = { ...draft, ...partial }
    setDraft(next)
    const patchPayload: Record<string, unknown> = {}
    if (partial.method !== undefined) patchPayload.method = next.method
    if (partial.url !== undefined) patchPayload.url = next.url
    if (partial.body_template !== undefined) patchPayload.body_template = next.body_template
    if (partial.store_as !== undefined) patchPayload.store_as = next.store_as
    if (Object.keys(patchPayload).length > 0) onPatchConfig(patchPayload)
  }

  return (
    <div className="relative z-20 space-y-0" onPointerDown={(e) => e.stopPropagation()}>
      <FieldBlock label="Method">
        <select
          value={draft.method}
          onChange={(e) => patch({ method: e.target.value })}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
        </select>
      </FieldBlock>
      <FieldBlock label="URL">
        <input
          type="text"
          value={draft.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="https://api.hexanova.in/api/bookings/customer?phone={{contact.phone_primary}}"
          className="h-8 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 font-mono text-xs text-white outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/40"
          autoComplete="off"
          spellCheck={false}
        />
      </FieldBlock>
      <p className="mb-2 text-[11px] text-slate-500">
        Variables: {"{{contact.phone_primary}}"}, {"{{vars.pickup_date}}"}, etc. URLs containing{" "}
        <code className="text-slate-400">bookings/customer</code> set{" "}
        <code className="text-slate-400">vars.customer_found</code>. A 404/not-found response
        continues the flow (use your Condition → No branch for new customers).
      </p>
      <FieldBlock label="Headers (JSON object)">
        <textarea
          value={draft.headersText}
          onChange={(e) => {
            setDraft((d) => ({ ...d, headersText: e.target.value }))
            setHeadersError(null)
          }}
          onBlur={(e) => {
            const result = parseJsonObjectFieldValue(e.target.value)
            if (!result.ok) {
              setHeadersError(result.error)
              return
            }
            setHeadersError(null)
            onPatchConfig({ headers: result.value })
            setDraft((d) => ({
              ...d,
              headersText: JSON.stringify(result.value, null, 2),
            }))
          }}
          className="min-h-16 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 font-mono text-xs text-white outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/40"
          spellCheck={false}
        />
        {headersError ? (
          <p className="mt-1 text-[11px] text-red-400">{headersError}</p>
        ) : (
          <p className="mt-1 text-[11px] text-slate-500">
            Edit freely; applied when you click away from this field.
          </p>
        )}
      </FieldBlock>
      <FieldBlock label="Body template (POST/PUT)">
        <textarea
          value={draft.body_template}
          onChange={(e) => patch({ body_template: e.target.value })}
          className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 font-mono text-xs text-white outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/40"
          spellCheck={false}
        />
      </FieldBlock>
      <FieldBlock label="Store response as variable">
        <input
          type="text"
          value={draft.store_as}
          onChange={(e) => patch({ store_as: e.target.value })}
          placeholder="booking_result"
          className="h-8 w-full min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-sm text-white outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/40"
          autoComplete="off"
        />
      </FieldBlock>
    </div>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onPatchConfig,
}: {
  step: BuilderStep
  onPatchConfig: (patch: Record<string, unknown>) => void
}) {
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) => onPatchConfig(patch)

  switch (step.step_type) {
    case "send_message":
      return (
        <FieldBlock label="Message text">
          <Textarea
            value={(cfg.text as string) ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Hi! Thanks for reaching out…"
            className="min-h-24 bg-slate-800 text-white"
          />
        </FieldBlock>
      )
    case "send_template":
      return (
        <>
          <FieldBlock label="Template name">
            <Input
              value={(cfg.template_name as string) ?? ""}
              onChange={(e) => set({ template_name: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Language">
            <Input
              value={(cfg.language as string) ?? ""}
              onChange={(e) => set({ language: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </>
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label="Tag id">
          <Input
            value={(cfg.tag_id as string) ?? ""}
            onChange={(e) => set({ tag_id: e.target.value })}
            className="bg-slate-800 text-white"
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label="Mode">
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="round_robin">Round-robin</option>
              <option value="specific">Specific agent</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label="Agent id">
              <Input
                value={(cfg.agent_id as string) ?? ""}
                onChange={(e) => set({ agent_id: e.target.value })}
                className="bg-slate-800 text-white"
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label="Field">
            <select
              value={(cfg.field as string) ?? "name"}
              onChange={(e) => set({ field: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="name">Name</option>
              <option value="email">Email</option>
              <option value="company">Company</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Value">
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <FieldBlock label="Pipeline id">
            <Input
              value={(cfg.pipeline_id as string) ?? ""}
              onChange={(e) => set({ pipeline_id: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Stage id">
            <Input
              value={(cfg.stage_id as string) ?? ""}
              onChange={(e) => set({ stage_id: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Title">
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Value">
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label="Amount">
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Unit">
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition":
      return (
        <>
          <FieldBlock label="Subject">
            <select
              value={(cfg.subject as string) ?? "tag_presence"}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="tag_presence">Tag presence</option>
              <option value="contact_field">Contact field</option>
              <option value="message_content">Message content</option>
              <option value="time_of_day">Time of day</option>
              <option value="variable_truthy">Variable is set / true</option>
              <option value="variable_equals">Variable equals value</option>
            </select>
          </FieldBlock>
          <FieldBlock
            label={
              cfg.subject === "variable_truthy" || cfg.subject === "variable_equals"
                ? "Variable name"
                : "Operand"
            }
          >
            <Input
              placeholder={
                cfg.subject === "time_of_day"
                  ? "HH:mm-HH:mm"
                  : cfg.subject === "contact_field"
                  ? "name / email / company"
                  : cfg.subject === "tag_presence"
                  ? "tag id"
                  : cfg.subject === "variable_truthy" || cfg.subject === "variable_equals"
                  ? "e.g. customer_found"
                  : ""
              }
              value={(cfg.operand as string) ?? ""}
              onChange={(e) => set({ operand: e.target.value })}
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          {(cfg.subject === "contact_field" ||
            cfg.subject === "message_content" ||
            cfg.subject === "variable_equals") && (
            <FieldBlock label="Value">
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-slate-800 text-white"
              />
            </FieldBlock>
          )}
        </>
      )
    case "send_webhook":
      return (
        <>
          <FieldBlock label="URL">
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://api.example.com/hook"
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <FieldBlock label="Method">
            <select
              value={(cfg.method as string) ?? "POST"}
              onChange={(e) => set({ method: e.target.value })}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Body template (JSON)">
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-slate-800 font-mono text-xs text-white"
            />
          </FieldBlock>
        </>
      )
    case "http_request":
      return (
        <HttpRequestStepEditor
          stepCid={step.cid}
          config={cfg}
          onPatchConfig={set}
        />
      )
    case "wait_for_reply":
      return (
        <>
          <FieldBlock label="Save reply to variable">
            <Input
              value={(cfg.save_reply_to as string) ?? ""}
              onChange={(e) => set({ save_reply_to: e.target.value })}
              placeholder="pickup_date"
              className="bg-slate-800 text-white"
            />
          </FieldBlock>
          <p className="text-xs text-slate-400">
            Flow pauses until the customer sends their next message. That text is saved to{" "}
            <code className="text-slate-300">vars.&lt;name&gt;</code> and following steps run.
          </p>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-xs text-slate-400">
          Sets the conversation status to &quot;closed&quot;. No configuration needed.
        </p>
      )
    case "start_pickup_booking":
      return (
        <p className="text-xs text-slate-400">
          Tags the contact and sends pickup booking instructions. When they reply with
          Name, Locality, Address, Date, and Slot, the booking is created via your
          Hexanova API (server env vars).
        </p>
      )
    default:
      return null
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function previewFor(step: BuilderStep): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || "no text yet"
    case "send_template":
      return (step.step_config.template_name as string) || "pick a template"
    case "wait":
      return `${step.step_config.amount ?? "?"} ${step.step_config.unit ?? ""}`
    case "condition":
      return `when ${step.step_config.subject ?? "?"}`
    case "send_webhook":
      return (step.step_config.url as string) || "no url"
    case "http_request": {
      const m = (step.step_config.method as string) || "GET"
      const u = (step.step_config.url as string) || "no url"
      return `${m} ${u}`
    }
    case "wait_for_reply":
      return step.step_config.save_reply_to
        ? `→ vars.${step.step_config.save_reply_to}`
        : "wait for customer"
    case "start_pickup_booking":
      return "pickup booking flow"
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

function hasLegacyPickupStep(steps: BuilderStep[]): boolean {
  for (const s of steps) {
    if (s.step_type === "start_pickup_booking") return true
    if (s.branches?.yes?.length && hasLegacyPickupStep(s.branches.yes)) return true
    if (s.branches?.no?.length && hasLegacyPickupStep(s.branches.no)) return true
  }
  return false
}

function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((s) => {
    if (s.cid !== parent.parentCid || !s.branches) return s
    const list = [...s.branches[parent.branch]]
    list.splice(index, 0, node)
    return { ...s, branches: { ...s.branches, [parent.branch]: list } }
  })
}

function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  const normalized = normalizeStepsForApi(steps)
  return normalized.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
