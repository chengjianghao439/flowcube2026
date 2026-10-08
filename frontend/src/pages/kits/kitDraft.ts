import type { CreateKitInput, KitDefinition, UpdateKitInput } from '@/types/kits'
export interface KitComponentDraft {
  productId: number; code: string; name: string; unit: string
  allowDecimal: boolean; active: boolean; quantity: string; weight: string
}
export interface KitDraft {
  code: string; name: string; isActive: boolean; price: string
  priceB: string; priceC: string; priceD: string
  categoryId: number | null; categoryName: string; supplierId: number | null; supplierName: string
  unit: string; spec: string; color: string; articleNumber: string; costPrice: string; remark: string
  mode: 'product_a' | 'explicit'; components: KitComponentDraft[]
}
export const emptyKitDraft = (): KitDraft => ({ code: '', name: '', isActive: true, price: '', priceB: '', priceC: '', priceD: '', categoryId: null, categoryName: '', supplierId: null, supplierName: '', unit: '套', spec: '', color: '', articleNumber: '', costPrice: '', remark: '', mode: 'product_a', components: [] })
export function draftFromKit(kit: KitDefinition): KitDraft {
  const components = kit.version?.components ?? []
  const priceA = kit.salePriceA ?? kit.version?.salePriceA ?? kit.version?.referenceUnitPrice ?? 0
  return {
    code: kit.code, name: kit.name, isActive: kit.isActive, price: String(priceA),
    priceB: String(kit.salePriceB ?? kit.version?.salePriceB ?? priceA), priceC: String(kit.salePriceC ?? kit.version?.salePriceC ?? priceA), priceD: String(kit.salePriceD ?? kit.version?.salePriceD ?? priceA),
    categoryId: kit.categoryId ?? null, categoryName: kit.categoryName ?? '', supplierId: kit.supplierId ?? null, supplierName: kit.supplierName ?? '',
    unit: kit.unit || '套', spec: kit.spec ?? '', color: kit.color ?? '', articleNumber: kit.articleNumber ?? '', costPrice: kit.costPrice != null ? String(kit.costPrice) : '', remark: kit.remark ?? '',
    mode: components.length && components.every(c => c.weightSource === 'explicit') ? 'explicit' : 'product_a',
    components: components.map(c => ({
      productId: c.productId, code: c.productCode ?? '', name: c.productName ?? `商品 #${c.productId}`,
      unit: c.unit ?? '—', allowDecimal: c.allowDecimal, active: c.productActive, quantity: String(c.baseQty),
      // 派生权重可达六位，只有原显式四位输入可回填编辑框。
      weight: c.weightSource === 'explicit' ? String(Number(c.amountWeight)) : '',
    })),
  }
}
function compositionSignature(draft: KitDraft) {
  return JSON.stringify([draft.mode, draft.components.map(c => [c.productId, Number(c.quantity), draft.mode === 'explicit' ? (c.weight.trim() ? Number(c.weight) : null) : null])])
}
export function compositionChanged(draft: KitDraft, baseline?: KitDefinition) {
  return !baseline || compositionSignature(draft) !== compositionSignature(draftFromKit(baseline))
}
function decimal(raw: string, scale: number, max: number, label: string) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(raw.trim()) || !Number.isFinite(Number(raw)) || Number(raw) > max) {
    throw new Error(`${label}须为非负数，最多 ${scale} 位小数且在允许范围内`)
  }
  return Number(raw)
}
export function buildKitPayload(draft: KitDraft): CreateKitInput
export function buildKitPayload(draft: KitDraft, baseline: KitDefinition): UpdateKitInput
export function buildKitPayload(draft: KitDraft, baseline?: KitDefinition): CreateKitInput | UpdateKitInput {
  const name = draft.name.trim()
  if (!name || name.length > 150) throw new Error('请填写名称，最多 150 个字符')
  if (!Number.isSafeInteger(draft.categoryId) || !draft.categoryId || draft.categoryId <= 0) throw new Error('请选择商品分类')
  if (!Number.isSafeInteger(draft.supplierId) || !draft.supplierId || draft.supplierId <= 0) throw new Error('请选择供应商')
  const requiredText = (raw: string, max: number, label: string) => {
    const value = raw.trim()
    if (!value || value.length > max) throw new Error(`请填写${label}，最多 ${max} 个字符`)
    return value
  }
  const optionalText = (raw: string, max: number, label: string) => {
    const value = raw.trim()
    if (value.length > max) throw new Error(`${label}最多 ${max} 个字符`)
    return value
  }
  const costPrice = decimal(draft.costPrice, 4, 99999999.9999, '进价')
  if (costPrice <= 0) throw new Error('进价须大于零')
  const payload: UpdateKitInput = {
    name, isActive: draft.isActive, categoryId: draft.categoryId, supplierId: draft.supplierId,
    unit: requiredText(draft.unit, 20, '单位'), spec: requiredText(draft.spec, 100, '型号'), color: requiredText(draft.color, 30, '颜色'),
    articleNumber: optionalText(draft.articleNumber, 100, '供应商型号'), costPrice, remark: optionalText(draft.remark, 30, '备注'), revision: baseline?.revision ?? 1,
  }
  const prices = [['price', 'salePriceA', 'A'], ['priceB', 'salePriceB', 'B'], ['priceC', 'salePriceC', 'C'], ['priceD', 'salePriceD', 'D']] as const
  const original = baseline ? draftFromKit(baseline) : null
  for (const [field, target, level] of prices) {
    // 保留历史空档；界面的 A 价回退只供显示，未改不能写成新价格版本。
    // 新建省略空档；编辑明确清空用 null，省略仍表示保留原价。
    if (draft[field].trim() !== '') {
      const value = decimal(draft[field], 4, 99999999.9999, `价格${level}`)
      if (!original || value !== Number(original[field])) payload[target] = value
    }
    else if (baseline) payload[target] = null
  }
  if (payload.salePriceA != null) payload.referenceUnitPrice = payload.salePriceA
  if (compositionChanged(draft, baseline)) {
    if (!draft.components.length || draft.components.length > 50) throw new Error('组成须包含 1 至 50 个组件')
    const ids = new Set(draft.components.map(c => c.productId))
    if (ids.size !== draft.components.length) throw new Error('组成不能重复选择同一个商品')
    if (draft.mode === 'explicit' && draft.components.some(c => !c.weight.trim())) throw new Error('显式分摊须为全部组件填写比例，不能与默认依据混用')
    payload.components = draft.components.map(c => {
      if (!Number.isSafeInteger(c.productId) || c.productId <= 0 || !c.active) throw new Error(`组件「${c.name}」须为启用的真实商品`)
      const baseQty = decimal(c.quantity, 2, 9999999999.99, `「${c.name}」每套基本量`)
      if (baseQty <= 0) throw new Error(`「${c.name}」每套基本量须大于零`)
      if (!c.allowDecimal && !Number.isInteger(baseQty)) throw new Error(`「${c.name}」只能填写整数基本量`)
      return { productId: c.productId, baseQty, ...(draft.mode === 'explicit' ? { amountWeight: decimal(c.weight, 4, 99999999.9999, `「${c.name}」分摊比例`) } : {}) }
    })
    if (draft.mode === 'explicit' && !payload.components.some(c => c.amountWeight! > 0)) throw new Error('分摊比例合计须大于零，个别组件可填零')
  }
  if (baseline) return payload
  const { revision: _revision, ...creation } = payload
  return creation as CreateKitInput
}
