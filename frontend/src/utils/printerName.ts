/**
 * 与桌面端 main 中打印机名校验一致，避免 NFC/NFD、不间断空格等导致「已添加却打不出来」
 */
export function normalizeSystemPrinterName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
}

export type SystemPrinterRow = {
  name: string
  displayName: string
  description: string
  status: number
  isDefault: boolean
}

/** 从本机列表中解析出与下拉选中项对应的行（按 name / displayName 规范化匹配） */
export function pickSystemPrinterRow(
  rows: SystemPrinterRow[],
  selectedName: string,
): SystemPrinterRow | null {
  const t = normalizeSystemPrinterName(selectedName)
  if (!t) return null
  const byName = rows.find((p) => normalizeSystemPrinterName(p.name) === t)
  if (byName) return byName
  return (
    rows.find((p) => normalizeSystemPrinterName(p.displayName || '') === t) ?? null
  )
}
