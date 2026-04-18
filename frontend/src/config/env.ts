function normalizeOrigin(raw: string | undefined): string {
  const value = String(raw || '').trim().replace(/\/$/, '')
  if (!value) return ''
  try {
    const parsed = new URL(value.startsWith('http') ? value : `http://${value}`)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return ''
  }
}

export const ERP_PRODUCTION_ORIGIN = normalizeOrigin(import.meta.env.VITE_ERP_PRODUCTION_ORIGIN)
export const PDA_FALLBACK_API_ORIGIN = normalizeOrigin(import.meta.env.VITE_PDA_FALLBACK_API_ORIGIN)
