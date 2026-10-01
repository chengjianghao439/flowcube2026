import type { CreateKitInput, KitDefinition, UpdateKitInput } from '@/types/kits'
export interface KitComponentDraft {
  productId: number; code: string; name: string; unit: string
  allowDecimal: boolean; active: boolean; quantity: string; weight: string
}
export interface KitDraft {
  code: string; name: string; isActive: boolean; price: string
  mode: 'product_a' | 'explicit'; components: KitComponentDraft[]
}
export const emptyKitDraft = (): KitDraft => ({ code: '', name: '', isActive: true, price: '', mode: 'product_a', components: [] })
export function draftFromKit(kit: KitDefinition): KitDraft {
  const components = kit.version?.components ?? []
  return {
    code: kit.code, name: kit.name, isActive: kit.isActive, price: String(kit.version?.referenceUnitPrice ?? 0),
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
  const code = draft.code.trim(), name = draft.name.trim()
  if (!code || code.length > 50) throw new Error('请填写编码，最多 50 个字符')
  if (!name || name.length > 150) throw new Error('请填写名称，最多 150 个字符')
  const payload: UpdateKitInput = { code, name, isActive: draft.isActive, referenceUnitPrice: decimal(draft.price, 4, 99999999.9999, '每套默认报价'), revision: baseline?.revision ?? 1 }
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
