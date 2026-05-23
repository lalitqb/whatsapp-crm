import type { TemplateHeaderMediaType } from '@/lib/whatsapp/meta-api'

const ALLOWED_MIME: Record<string, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  video: ['video/mp4'],
  document: ['application/pdf'],
}

export function isMediaHeaderType(
  headerType: string | null | undefined,
): boolean {
  if (!headerType) return false
  const t = headerType.toLowerCase()
  return t === 'image' || t === 'video' || t === 'document'
}

export function headerTypeToMediaType(
  headerType: string | null | undefined,
): TemplateHeaderMediaType {
  const t = (headerType ?? 'image').toLowerCase()
  if (t === 'video') return 'video'
  if (t === 'document') return 'document'
  return 'image'
}

export function validateHeaderMediaFile(
  headerType: string,
  mimeType: string,
  sizeBytes: number,
): string | null {
  const kind = headerType.toLowerCase()
  const allowed = ALLOWED_MIME[kind]
  if (!allowed) {
    return `Template header type "${headerType}" does not support file upload.`
  }
  if (!allowed.includes(mimeType)) {
    return `Invalid file type ${mimeType} for ${kind} header. Allowed: ${allowed.join(', ')}`
  }
  const maxMb = kind === 'video' ? 16 : kind === 'document' ? 8 : 5
  if (sizeBytes > maxMb * 1024 * 1024) {
    return `File too large. Max ${maxMb} MB for ${kind} headers.`
  }
  return null
}

export function sanitizeStorageFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}
