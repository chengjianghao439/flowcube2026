const DEFAULT_RATES = {
  A: 10,
  B: 20,
  C: 30,
  D: 40,
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function roundPrice(value) {
  return Math.round(toNumber(value) * 10000) / 10000
}

async function loadPriceRates(db) {
  const [rows] = await db.query(
    'SELECT key_name, value FROM sys_settings WHERE key_name IN (?,?,?,?)',
    ['price_rate_a', 'price_rate_b', 'price_rate_c', 'price_rate_d'],
  )

  const map = Object.fromEntries(rows.map(row => [row.key_name, row.value]))
  return {
    A: toNumber(map.price_rate_a, DEFAULT_RATES.A),
    B: toNumber(map.price_rate_b, DEFAULT_RATES.B),
    C: toNumber(map.price_rate_c, DEFAULT_RATES.C),
    D: toNumber(map.price_rate_d, DEFAULT_RATES.D),
  }
}

function computeTierPrices(costPrice, rates = DEFAULT_RATES) {
  const cost = toNumber(costPrice, 0)
  const mk = (rate) => roundPrice(cost * (1 + toNumber(rate, 0) / 100))

  const salePriceA = mk(rates.A)
  const salePriceB = mk(rates.B)
  const salePriceC = mk(rates.C)
  const salePriceD = mk(rates.D)

  return {
    costPrice: roundPrice(cost),
    salePrice: salePriceA,
    salePriceA,
    salePriceB,
    salePriceC,
    salePriceD,
  }
}

function priceLevelLabel(level) {
  const normalized = String(level || 'A').toUpperCase()
  return `价格${normalized}`
}

module.exports = {
  DEFAULT_RATES,
  loadPriceRates,
  computeTierPrices,
  priceLevelLabel,
}
