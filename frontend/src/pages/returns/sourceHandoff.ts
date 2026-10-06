export type ReturnSourceHandoff = { id: number; orderNo: string }
/** 本标签只携带原单身份，明细、价格和可退量必须由来源接口读取。 */
export function readReturnSourceHandoff(path: string, kind: 'sale' | 'purchase'): ReturnSourceHandoff | 'invalid' | null {
  const [pathname, search = ''] = path.split('?')
  if (pathname !== `/returns/${kind}/new`) return null
  const params = new URLSearchParams(search)
  if (!['sourceId', 'sourceNo', 'sourceType'].some(key => params.has(key))) return null
  const ids = params.getAll('sourceId'), numbers = params.getAll('sourceNo'), types = params.getAll('sourceType')
  if (ids.length !== 1 || numbers.length !== 1 || !/^[1-9]\d*$/.test(ids[0]) || !numbers[0].trim() || types.length > 1 || (types.length === 1 && types[0] !== kind)) return 'invalid'
  const id = Number(ids[0])
  return Number.isSafeInteger(id) && id > 0 ? { id, orderNo: numbers[0].trim() } : 'invalid'
}
