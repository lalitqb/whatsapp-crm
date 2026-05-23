/**
 * Build Meta send payload (body + URL buttons) from fetched template components.
 */

import type {
  TemplateBodyParameter,
  TemplateHeaderMediaParameter,
  TemplateHeaderMediaType,
  TemplateUrlButtonParameter,
} from '@/lib/whatsapp/meta-api'
import {
  extractNamedParamNames,
  extractTemplateSlots,
  isNamedParameterTemplate,
  resolveNamedTemplateParams,
  sanitizeTemplateVariableValue,
} from '@/lib/whatsapp/template-params'
import type { MetaTemplateComponent } from '@/lib/whatsapp/template-components'

export type MetaParameterFormat = 'NAMED' | 'POSITIONAL'

export interface TemplateSendPlanInput {
  body_text: string
  components?: MetaTemplateComponent[]
  parameter_format?: MetaParameterFormat | string | null
  url_button_indexes?: number[]
}

export interface HeaderMediaInput {
  url?: string
  type?: TemplateHeaderMediaType | string
  filename?: string
}

export interface TemplateSendPlan {
  bodyParameters: TemplateBodyParameter[]
  buttonParameters: TemplateUrlButtonParameter[]
  headerMedia?: TemplateHeaderMediaParameter
  parameterFormat: MetaParameterFormat
  bodyParamNames: string[]
  headerFormat?: string
  headerTextParamCount: number
}

type BodyExample = {
  body_text_named_params?: Array<{ param_name: string }>
}

function findBodyComponent(
  components?: MetaTemplateComponent[],
): MetaTemplateComponent | undefined {
  return components?.find((c) => c.type === 'BODY' || c.type === 'body')
}

function inferParameterFormat(
  input: TemplateSendPlanInput,
): MetaParameterFormat {
  const fmt = input.parameter_format?.toString().toUpperCase()
  if (fmt === 'NAMED' || fmt === 'POSITIONAL') return fmt
  if (isNamedParameterTemplate(input.body_text)) return 'NAMED'
  return 'POSITIONAL'
}

/** Authoritative named param order from Meta BODY example when present. */
export function getBodyNamedParamOrder(
  components?: MetaTemplateComponent[],
  bodyText?: string,
): string[] {
  const body = findBodyComponent(components)
  const example = body?.example as BodyExample | undefined
  if (example?.body_text_named_params?.length) {
    return example.body_text_named_params.map((p) =>
      p.param_name.toLowerCase(),
    )
  }
  return extractNamedParamNames(body?.text ?? bodyText ?? '')
}

export interface UrlButtonParamSpec {
  index: number
  paramName?: string
}

export function getUrlButtonParamSpecs(
  components?: MetaTemplateComponent[],
): UrlButtonParamSpec[] {
  if (!components?.length) return []

  const buttonsBlock = components.find(
    (c) => c.type === 'BUTTONS' || c.type === 'buttons',
  )
  if (!buttonsBlock?.buttons?.length) return []

  const specs: UrlButtonParamSpec[] = []
  buttonsBlock.buttons.forEach((btn, index) => {
    if (btn.type !== 'URL' || !btn.url) return
    const named = btn.url.match(/\{\{([a-z][a-z0-9_]*)\}\}/i)
    const positional = /\{\{\d+\}\}/.test(btn.url)
    if (!named && !positional) return
    specs.push({
      index,
      paramName: named ? named[1].toLowerCase() : undefined,
    })
  })
  return specs
}

function resolveVariable(
  variables: Record<string, string>,
  key: string,
  variableOrder?: string[],
): string {
  if (variables[key] !== undefined) {
    return sanitizeTemplateVariableValue(variables[key])
  }
  if (variableOrder) {
    const idx = variableOrder.indexOf(key)
    if (idx >= 0 && variableOrder[idx]) {
      return sanitizeTemplateVariableValue(variables[variableOrder[idx]])
    }
  }
  return '—'
}

function buildNamedBodyParameters(
  paramNames: string[],
  variables: Record<string, string>,
  variableOrder?: string[],
): TemplateBodyParameter[] {
  const missing: string[] = []
  const params = paramNames.map((name) => {
    const text = resolveVariable(variables, name, variableOrder)
    if (text === '—') missing.push(name)
    return {
      type: 'text' as const,
      parameter_name: name,
      text,
    }
  })
  if (missing.length > 0) {
    throw new Error(
      `Missing template variables for body: ${missing.join(', ')}. ` +
        `Expected: ${paramNames.join(', ')}`,
    )
  }
  return params
}

function findHeaderComponent(
  components?: MetaTemplateComponent[],
): MetaTemplateComponent | undefined {
  return components?.find((c) => c.type === 'HEADER' || c.type === 'header')
}

function mediaTypeFromHeaderFormat(
  format: string,
): TemplateHeaderMediaType {
  const f = format.toUpperCase()
  if (f === 'VIDEO') return 'video'
  if (f === 'DOCUMENT') return 'document'
  return 'image'
}

export function resolveHeaderMedia(
  components: MetaTemplateComponent[] | undefined,
  variables: Record<string, string>,
  explicit?: HeaderMediaInput | null,
): TemplateHeaderMediaParameter | undefined {
  const header = findHeaderComponent(components)
  if (!header) return undefined

  const format = (header.format ?? '').toUpperCase()
  if (format !== 'IMAGE' && format !== 'VIDEO' && format !== 'DOCUMENT') {
    return undefined
  }

  const url =
    explicit?.url?.trim() ||
    variables.header_image_url?.trim() ||
    variables.header_media_url?.trim() ||
    variables.header_video_url?.trim() ||
    variables.header_document_url?.trim()

  if (!url) {
    throw new Error(
      `Template "${format}" header requires media. ` +
        'Upload the default header in Settings → Templates, or pass headerMedia.url / variables.header_image_url (public HTTPS).',
    )
  }

  if (!url.startsWith('https://')) {
    throw new Error(
      'Header media URL must be a public HTTPS link (Meta cannot fetch http:// or local URLs).',
    )
  }

  const typeRaw =
    explicit?.type?.toString().toLowerCase() ||
    variables.header_media_type?.toLowerCase() ||
    mediaTypeFromHeaderFormat(format)

  const type: TemplateHeaderMediaType =
    typeRaw === 'video'
      ? 'video'
      : typeRaw === 'document'
        ? 'document'
        : 'image'

  return {
    type,
    url,
    filename:
      explicit?.filename?.trim() ||
      variables.header_document_filename?.trim() ||
      (type === 'document' ? 'document.pdf' : undefined),
  }
}

function analyzeTextHeader(components?: MetaTemplateComponent[]): {
  headerTextParamCount: number
} {
  const header = findHeaderComponent(components)
  if (!header) return { headerTextParamCount: 0 }
  const format = (header.format ?? '').toUpperCase()
  if (format === 'TEXT' && header.text) {
    const slots = extractTemplateSlots(header.text)
    const names = extractNamedParamNames(header.text)
    return {
      headerTextParamCount: slots.length || names.length,
    }
  }
  return { headerTextParamCount: 0 }
}

export function buildTemplateSendPlan(
  input: TemplateSendPlanInput,
  variables: Record<string, string>,
  options?: {
    mapping?: Record<string, number | string> | null
    variableOrder?: string[]
    headerMedia?: HeaderMediaInput | null
  },
): TemplateSendPlan {
  const parameterFormat = inferParameterFormat(input)
  const headerFormat = findHeaderComponent(input.components)?.format?.toUpperCase()
  const textHeaderInfo = analyzeTextHeader(input.components)
  const headerMedia = resolveHeaderMedia(
    input.components,
    variables,
    options?.headerMedia,
  )

  if (textHeaderInfo.headerTextParamCount > 0) {
    throw new Error(
      `Template header expects ${textHeaderInfo.headerTextParamCount} variable(s). ` +
        'Add header variables to the API or use a template with a static header.',
    )
  }

  let bodyParameters: TemplateBodyParameter[]
  let bodyParamNames: string[]

  if (parameterFormat === 'NAMED') {
    bodyParamNames = getBodyNamedParamOrder(
      input.components,
      input.body_text,
    )
    if (bodyParamNames.length === 0) {
      bodyParameters = []
    } else {
      bodyParameters = buildNamedBodyParameters(
        bodyParamNames,
        variables,
        options?.variableOrder,
      )
    }
  } else {
    const slots = extractTemplateSlots(input.body_text)
    bodyParamNames = slots.map(String)
    const positional = resolveNamedTemplateParams(
      input.body_text,
      variables,
      options,
    )
    if (positional.some((v) => v === '—')) {
      const missingIdx = positional
        .map((v, i) => (v === '—' ? i + 1 : null))
        .filter((x): x is number => x !== null)
      throw new Error(
        `Missing template variables for body slots {{${missingIdx.join('}}, {{')}}}. ` +
          `Use variableOrder: ${JSON.stringify(options?.variableOrder ?? [])}`,
      )
    }
    bodyParameters = positional.map((text) => ({ type: 'text', text }))
  }

  const buttonSpecs = getUrlButtonParamSpecs(input.components)
  const buttonParameters: TemplateUrlButtonParameter[] = buttonSpecs.map(
    (spec) => {
      const suffixKey = spec.paramName ?? 'button_url_suffix'
      const text =
        variables[suffixKey] ??
        variables.button_url_suffix ??
        variables.track_url_suffix ??
        variables.order_id ??
        '—'

      const sanitized = sanitizeTemplateVariableValue(text)
      if (sanitized === '—') {
        throw new Error(
          `Missing URL button variable "${suffixKey}" (or button_url_suffix / order_id). ` +
            'Dynamic track-order buttons need a suffix value.',
        )
      }

      const param: TemplateBodyParameter = { type: 'text', text: sanitized }
      if (parameterFormat === 'NAMED' && spec.paramName) {
        param.parameter_name = spec.paramName
      }

      return {
        index: spec.index,
        parameters: [param],
      }
    },
  )

  return {
    bodyParameters,
    buttonParameters,
    headerMedia,
    parameterFormat,
    bodyParamNames,
    headerFormat,
    headerTextParamCount: textHeaderInfo.headerTextParamCount,
  }
}

/** Map broadcast personalization array → variable map for send plan. */
export function broadcastParamsToVariables(
  params: string[],
  bodyText: string,
  components?: MetaTemplateComponent[],
  parameterFormat?: string | null,
): Record<string, string> {
  const fmt =
    parameterFormat?.toString().toUpperCase() === 'NAMED' ||
    isNamedParameterTemplate(bodyText)
      ? 'NAMED'
      : 'POSITIONAL'

  const vars: Record<string, string> = {}

  if (fmt === 'NAMED') {
    const names = getBodyNamedParamOrder(components, bodyText)
    names.forEach((name, i) => {
      if (params[i] !== undefined) vars[name] = params[i]
    })
    return vars
  }

  const slots = extractTemplateSlots(bodyText)
  if (slots.length > 0) {
    slots.forEach((slot, i) => {
      if (params[i] !== undefined) vars[String(slot)] = params[i]
    })
  } else {
    params.forEach((val, i) => {
      vars[String(i + 1)] = val
    })
  }
  return vars
}

/** Prefer Meta components; fall back to local body_text only. */
export function buildTemplateSendPlanFromSources(
  meta: TemplateSendPlanInput | null | undefined,
  local: { body_text: string },
  variables: Record<string, string>,
  options?: {
    mapping?: Record<string, number | string> | null
    variableOrder?: string[]
    headerMedia?: HeaderMediaInput | null
  },
): TemplateSendPlan {
  const source: TemplateSendPlanInput = meta?.components?.length
    ? {
        body_text: meta.body_text || local.body_text,
        components: meta.components,
        parameter_format: meta.parameter_format,
      }
    : {
        body_text: local.body_text,
        parameter_format: inferParameterFormat({
          body_text: local.body_text,
          parameter_format: null,
        }),
      }

  return buildTemplateSendPlan(source, variables, options)
}
