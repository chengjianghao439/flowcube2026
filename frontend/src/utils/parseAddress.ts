/**
 * 收货地址「自动识别」纯函数。
 *
 * 把一整段粘贴文本（如「张三 13800138000 北京市朝阳区建国路88号」，或带
 * 「收货人：/电话：/地址：」标签、以逗号/换行分隔的格式）拆成 收货人 / 电话 / 地址。
 * 纯客户端启发式，离线可用；结果口径与销售单收货字段对齐（姓名≤5、11 位手机号、地址≤30）。
 *
 * 处理得最好的是「有分隔符」的常见粘贴格式（空格/逗号/换行）；完全无分隔符的连写串
 * 识别会退化，交由用户在识别后手动微调即可。
 */

// 地址特征词：命中即更可能是地址片段
const ADDRESS_KEYWORDS = /省|市|区|县|镇|乡|街道|街|路|号|栋|幢|单元|室|楼|层|村|大厦|广场|花园|小区|苑|巷|弄|组|队|开发区|工业园|自治区|盟|旗/
// 常见标签词，识别前先剥掉
const LABELS = /(收货人|收件人|姓名|联系人|联系电话|联系方式|电话|手机号|手机|地址|收货地址|所在地区|详细地址)\s*[：:]?/g

export interface ParsedAddress {
  name?: string
  phone?: string
  address?: string
}

export function parseAddressText(raw: string): ParsedAddress {
  if (!raw || !raw.trim()) return {}
  let text = raw.replace(/\r/g, ' ')

  // 1) 电话：先折叠数字之间的单个空格/连字符，命中 11 位手机号，再从原文移除该号段
  let phone: string | undefined
  const digitsCollapsed = text.replace(/(\d)[\s-](?=\d)/g, '$1')
  const phoneMatch = digitsCollapsed.match(/1[3-9]\d{9}/)
  if (phoneMatch) {
    phone = phoneMatch[0]
    // 构造允许分隔符的正则，把原文里这段号码（可能带空格/连字符）抠掉
    const pat = phone.split('').join('[\\s-]?')
    text = text.replace(new RegExp(pat), ' ')
  }

  // 2) 去标签词后按分隔符切 token
  text = text.replace(LABELS, ' ')
  const tokens = text
    .split(/[\s,，、;；|/\n\t]+/)
    .map(t => t.trim())
    .filter(Boolean)

  // 3) 地址：含特征词的最长 token；无特征词时取足够长的最长 token
  let address: string | undefined
  const addrCandidates = tokens.filter(t => ADDRESS_KEYWORDS.test(t))
  if (addrCandidates.length) {
    address = addrCandidates.reduce((a, b) => (b.length > a.length ? b : a))
  } else if (tokens.length) {
    const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a))
    if (longest.length >= 6) address = longest
  }

  // 4) 姓名：剩余 token 里长度 2-4、纯中文/字母、不含地址特征词者，取靠前的一个
  const name = tokens.find(t =>
    t !== address &&
    t.length >= 2 && t.length <= 4 &&
    /^[一-龥A-Za-z·]+$/.test(t) &&
    !ADDRESS_KEYWORDS.test(t),
  )

  return {
    name: name ? name.slice(0, 5) : undefined,
    phone,
    address: address ? address.slice(0, 30) : undefined,
  }
}
