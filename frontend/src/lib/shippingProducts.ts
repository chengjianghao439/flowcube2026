export const DEPPON_PRODUCT_OPTIONS = [
  ['DJBK', '大件标快'], ['DJTK', '大件特快'], ['DJTH', '大件特惠'],
  ['XJBK', '小件标快'], ['XJTK', '小件特快'], ['XJTH', '小件特惠'], ['YTYDS', '精准大票电商'],
] as const
export function shippingProductLabel(platform: string | null | undefined, code: string | null | undefined) {
  if (!code) return '沿用承运商默认产品'
  return platform === 'deppon' ? DEPPON_PRODUCT_OPTIONS.find(o => o[0] === code)?.[1] || code : `合同产品 ${code}`
}
