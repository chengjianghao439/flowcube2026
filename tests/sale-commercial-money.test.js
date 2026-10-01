'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const modulePath = path.resolve(__dirname, '../backend/src/modules/sale/sale.commercial-money.math.js')
const api = fs.existsSync(modulePath) ? require(modulePath) : {}
function call(name, ...args) {
  assert.equal(typeof api[name], 'function', `missing commercial money behavior: ${name}`)
  return api[name](...args)
}
const cumulative = (s, q) => call('projectCommercialCumulative', s, q)
const batch = (s, beforeQty, afterQty) => call('projectCommercialBatch', s, { beforeQty, afterQty })
const refund = (sourceAmount, sourceQty, beforeQualifiedQty, afterQualifiedQty) => call('projectCommercialRefund', { sourceAmount, sourceQty, beforeQualifiedQty, afterQualifiedQty })
const kit = (price, quantity, cents) => ({ kind: 'kit', originalQty: quantity, unitPrice: price, grossAmount: cents.reduce((a, b) => a + b, 0) / 100, components: cents.map((c, i) => ({ id: i + 1, sortNo: i, allocatedAmount: c / 100 })) })
const ordinary = (quantity, amount) => ({ kind: 'ordinary', originalQty: quantity, unitPrice: '0.33333333', grossAmount: amount, components: [{ id: 1, sortNo: 0, allocatedAmount: amount }] })
const amounts = p => p.components.map(c => c.amountCents)
function invalid(fn) {
  assert.throws(fn, e => e.isOperational === true && e.statusCode === 409 && e.code === 'SALE_COMMERCIAL_MONEY_INVALID')
}

// Independent small-Q oracle: visit actual high/low slots in the order in which
// parent rounding emits its extra cents, then distribute each component's fixed
// cyclic slot range. It does not share the production prefix-count formula.
function slotReference(priceUnits, Q, budgets) {
  const totalAt = q => Math.floor((priceUnits * q + 50) / 100)
  const G = totalAt(Q), base = Math.floor(G / Q), highCount = G % Q
  let high = 0, low = highCount, start = 0
  const slotAmounts = Array.from({ length: Q }, () => budgets.map(c => Math.floor(c / Q)))
  for (let i = 0; i < budgets.length; i++) {
    const count = budgets[i] % Q
    for (let j = 0; j < count; j++) slotAmounts[(start + j) % Q][i]++
    start = (start + count) % Q
  }
  const values = [budgets.map(() => 0)]
  for (let q = 1; q <= Q; q++) {
    const extra = totalAt(q) - totalAt(q - 1) - base
    assert.ok(extra === 0 || extra === 1)
    const slot = extra ? high++ : low++
    values.push(values[q - 1].map((v, i) => v + slotAmounts[slot][i]))
  }
  return values
}
function assertProjection(p) {
  assert.equal(p.components.reduce((s, c) => s + c.amountCents, 0), p.grossCents)
  assert.equal(p.grossAmount, p.grossCents / 100)
  for (const c of p.components) {
    assert.ok(Number.isSafeInteger(c.amountCents) && c.amountCents >= 0)
    assert.equal(c.amount, c.amountCents / 100)
  }
}

test('A100 and B200 freeze separate 80/20 and 160/40 source component amounts', () => {
  assert.deepEqual(amounts(cumulative(kit(100, 1, [8000, 2000]), 1)), [8000, 2000])
  assert.deepEqual(amounts(cumulative(kit(200, 1, [16000, 4000]), 1)), [16000, 4000])
})
test('kit cumulative amount follows original price4 half-up, including 1.005', () => {
  const s = kit('1.0050', 2, [101, 100])
  assert.equal(cumulative(s, 1).grossCents, 101)
  assert.equal(cumulative(s, 2).grossCents, 201)
  assert.equal(batch(s, 1, 2).grossCents, 100)
})
test('0.0049 price x 2 must retain a zero first batch instead of rounding total/2', () => {
  const s = kit('0.0049', 2, [1, 0])
  assert.deepEqual(amounts(cumulative(s, 1)), [0, 0])
  assert.deepEqual(amounts(batch(s, 1, 2)), [1, 0])
})
test('three kits with two one-cent components have monotone cumulative and nonnegative batches', () => {
  const s = kit('0.0067', 3, [1, 1])
  assert.deepEqual([0, 1, 2, 3].map(q => amounts(cumulative(s, q))), [[0, 0], [1, 0], [1, 0], [1, 1]])
  for (let q = 1; q <= 3; q++) assertProjection(batch(s, q - 1, q))
})
test('old cumulative component-prefix subtraction is disproved by a negative second batch', () => {
  // Mutation witness: the abandoned ratio-prefix algorithm passes the final
  // budget check, but violates monotonicity in the very next batch.
  const oldSecond = q => Math.floor((2 * q * 2 + 3) / 6) - Math.floor((q * 2 + 3) / 6)
  const acceptsNonnegative = fn => assert.ok(fn(2) - fn(1) >= 0, 'negative component batch')
  assert.throws(() => acceptsNonnegative(oldSecond), /negative component batch/)
  const s = kit('0.0067', 3, [1, 1])
  acceptsNonnegative(q => cumulative(s, q).components[1].amountCents)
})
test('cyclic ranges crossing the end of Q match independent actual-slot simulation', () => {
  const s = kit('0.0267', 3, [2, 2, 4])
  const expected = slotReference(267, 3, [2, 2, 4])
  for (let q = 0; q <= 3; q++) assert.deepEqual(amounts(cumulative(s, q)), expected[q])
})
test('seeded small-Q reference checks every cumulative, every adjacent batch and arbitrary batches', () => {
  let seed = 0x5a17c2c1
  const rand = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  for (let trial = 0; trial < 240; trial++) {
    const Q = 1 + rand(17), price = rand(3001), G = Math.floor((price * Q + 50) / 100), count = 1 + rand(8)
    let rest = G
    const budgets = Array.from({ length: count }, (_, i) => { const c = i === count - 1 ? rest : rand(rest + 1); rest -= c; return c })
    const s = kit((price / 10000).toFixed(4), Q, budgets)
    const expected = slotReference(price, Q, budgets)
    for (let q = 0; q <= Q; q++) {
      const p = cumulative(s, q)
      assertProjection(p)
      assert.deepEqual(amounts(p), expected[q], `trial ${trial}, q ${q}`)
      if (q) assert.deepEqual(amounts(batch(s, q - 1, q)), expected[q].map((v, i) => v - expected[q - 1][i]))
    }
    const before = rand(Q + 1), after = before + rand(Q - before + 1)
    assert.deepEqual(amounts(batch(s, before, after)), expected[after].map((v, i) => v - expected[before][i]))
  }
})
test('large quantity and fifty components stay bounded without allocating quantity-sized arrays', () => {
  const Q = 9999999999, G = Q * 100
  const budgets = Array.from({ length: 50 }, (_, i) => i === 49 ? G - Math.floor(G / 50) * 49 : Math.floor(G / 50))
  const s = kit(1, Q, budgets)
  let previous = Array(50).fill(0)
  for (const q of [0, 1, 4999999999, Q - 1, Q]) {
    const p = cumulative(s, q)
    assertProjection(p)
    amounts(p).forEach((v, i) => assert.ok(v >= previous[i]))
    previous = amounts(p)
  }
  assert.deepEqual(previous, budgets)
})
test('large fractional kit price and fifty non-Q budgets conserve high/low cyclic slots across batches', () => {
  const Q = 9999999999
  const parentCents = q => Number((1234n * BigInt(q) + 50n) / 100n)
  const G = parentCents(Q), part = Math.floor(G / 50)
  const budgets = Array.from({ length: 50 }, (_, i) => i === 49 ? G - part * 49 : part)
  // All remainders are nonzero; their consecutive ranges cross Q repeatedly.
  assert.ok(budgets.every(c => c % Q > 0))
  assert.ok(budgets.reduce((sum, c) => sum + c % Q, 0) > Q * 10)
  const s = kit('0.1234', Q, budgets)
  let previousQty = 0, previous = Array(50).fill(0)
  for (const q of [0, 1, 9999, Math.floor(Q / 2), Q - 1, Q]) {
    const p = cumulative(s, q), b = batch(s, previousQty, q)
    assertProjection(p); assertProjection(b)
    assert.equal(p.grossCents, parentCents(q))
    assert.equal(b.grossCents, parentCents(q) - parentCents(previousQty))
    amounts(p).forEach((v, i) => {
      assert.ok(v >= previous[i])
      assert.equal(b.components[i].amountCents, v - previous[i])
    })
    previousQty = q; previous = amounts(p)
  }
  assert.deepEqual(previous, budgets)
})
test('zero price and zero-budget components remain zero through every batch', () => {
  for (const s of [kit(0, 7, [0, 0]), kit('0.0014', 7, [0, 1, 0])]) {
    for (let q = 0; q <= 7; q++) {
      const p = cumulative(s, q); assertProjection(p)
      for (let i = 0; i < s.components.length; i++) if (s.components[i].allocatedAmount === 0) assert.equal(p.components[i].amountCents, 0)
    }
  }
})
test('fixed sortNo and id order makes shuffled snapshots deterministic without mutation', () => {
  const s = kit('0.0067', 3, [1, 1, 0])
  s.components = [{ id: '9', sortNo: '2', allocatedAmount: 0 }, { id: 7, sortNo: 0, allocatedAmount: 0.01 }, { id: 2, sortNo: 0, allocatedAmount: 0.01 }]
  const original = JSON.stringify(s)
  Object.freeze(s); Object.freeze(s.components); s.components.forEach(Object.freeze)
  const p = cumulative(s, 1)
  assert.deepEqual(p.components.map(c => c.componentId), [2, 7, 9])
  assert.deepEqual(amounts(p), [1, 0, 0])
  assert.equal(JSON.stringify(s), original)
  assert.deepEqual(p, cumulative({ ...s, components: [...s.components].reverse() }, 1))
  assert.doesNotThrow(() => JSON.stringify(p))
})
test('ordinary frozen gross wins over eight-place display price for one box of three pieces', () => {
  const s = ordinary(3, 1)
  assert.deepEqual([1, 2, 3].map(q => cumulative(s, q).grossAmount), [0.33, 0.67, 1])
  Object.defineProperty(s, 'unitPrice', { get() { throw new Error('display price must not be read') } })
  assert.equal(cumulative(s, 3).grossCents, 100)
})
test('ordinary percentage-unit fractional basic quantities allocate the last cent exactly', () => {
  const s = ordinary('0.03', '0.01')
  assert.deepEqual(['0', '.01', '.02', '.03'].slice(1).map(q => cumulative(s, `0${q}`).grossCents), [0, 1, 1])
  assert.deepEqual(amounts(batch(s, '0.01', '0.03')), [1])
  assertProjection(batch(s, '0.03', '0.03'))
})
test('DB decimal trailing zeros and finite scientific numbers preserve original scales', () => {
  const s = kit('1.0050000', '2.0000', [101, 100])
  s.grossAmount = '2.010000'; s.components[0].allocatedAmount = '1.010000'
  assert.equal(cumulative(s, 1e0).grossCents, 101)
  assert.equal(cumulative(kit(49e-4, 2e0, [1]), '1e0').grossCents, 0)
  assert.equal(cumulative(ordinary('3e-2', '1e-2'), '2e-2').grossCents, 1)
})
test('scientific strings outside exponent +/-100 or strings longer than 128 reject clearly', () => {
  for (const text of ['0e101', '0e-101', `1${'0'.repeat(101)}e-101`, '0'.repeat(129)]) {
    invalid(() => cumulative({ ...kit(0, 1, [0]), unitPrice: text }, 0))
    invalid(() => refund(text, 1, 0, 1))
  }
  assert.equal(cumulative(kit('0e100', 1, [0]), 1).grossCents, 0)
  assert.equal(cumulative(kit('0e-100', 1, [0]), 1).grossCents, 0)
  assert.equal(cumulative(kit('0'.repeat(128), 1, [0]), 1).grossCents, 0)
})
test('finite JSON Number zero is accepted even when its original notation was 0e101', () => {
  const zero = Number('0e101')
  assert.equal(zero, 0)
  assert.equal(cumulative(kit(zero, 1, [0]), 1).grossCents, 0)
  assert.equal(refund(zero, 1, 0, 1).refundCents, 0)
})
test('maximum price and exact maximum cent amount do not lose a cent', () => {
  const s = kit('99999999.9999', 100, [999999999999])
  assert.equal(cumulative(s, 100).grossCents, 999999999999)
  assert.equal(cumulative(s, 1).grossCents, 10000000000)
  assert.equal(cumulative(ordinary('9999999999.99', '9999999999.99'), '9999999999.99').grossCents, 999999999999)
})
test('invalid snapshot basis, component budget sum and original kit price total reject', () => {
  for (const s of [null, {}, { ...kit(1, 1, [100]), kind: 'unknown' }, { ...kit(1, 1, [100]), grossAmount: 2 }, kit(1, 2, [100]), { ...ordinary(1, 1), components: [] }, { ...ordinary(1, 1), components: [{ id: 1, sortNo: 0, allocatedAmount: 0.5 }, { id: 2, sortNo: 1, allocatedAmount: 0.5 }] }]) invalid(() => cumulative(s, 0))
})
test('components are bounded, unique and have valid stable order keys', () => {
  for (const components of [[], Array.from({ length: 51 }, (_, i) => ({ id: i + 1, sortNo: i, allocatedAmount: 0 })), [{ id: 1, sortNo: 0, allocatedAmount: 0 }, { id: '1', sortNo: 1, allocatedAmount: 0 }], [null], [{ id: true, sortNo: 0, allocatedAmount: 0 }], [{ id: 0, sortNo: 0, allocatedAmount: 0 }], [{ id: 1, sortNo: -1, allocatedAmount: 0 }], [{ id: 1, sortNo: 0.5, allocatedAmount: 0 }]]) invalid(() => cumulative({ ...kit(0, 1, [0]), components }, 0))
})
test('sparse component entries reject instead of silently projecting an unnamed zero component', () => {
  invalid(() => cumulative({ ...kit(0, 1, [0]), components: new Array(1) }, 0))
})
test('raw invalid values, excessive precision and overflow reject before rounding', () => {
  const invalidValues = [null, true, false, '', ' ', NaN, Infinity, -Infinity, -1, '0x1', {}, []]
  for (const value of invalidValues) {
    invalid(() => cumulative({ ...kit(1, 1, [100]), unitPrice: value }, 1))
    invalid(() => cumulative({ ...kit(1, 1, [100]), grossAmount: value }, 1))
    invalid(() => cumulative(kit(1, 1, [100]), value))
    invalid(() => cumulative({ ...kit(1, 1, [100]), originalQty: value }, 0))
  }
  for (const price of ['0.00001', 1e-20, '99999999.99991', '100000000', '1e101']) invalid(() => cumulative({ ...kit(1, 1, [100]), unitPrice: price }, 0))
  for (const amount of ['0.001', '9999999999.991', '10000000000']) {
    invalid(() => cumulative({ ...kit(1, 1, [100]), grossAmount: amount }, 0))
    invalid(() => cumulative({ ...kit(1, 1, [100]), components: [{ id: 1, sortNo: 0, allocatedAmount: amount }] }, 0))
  }
  for (const qty of ['0.001', '9999999999.991', '10000000000', 1e-20]) invalid(() => cumulative(ordinary(1, 1), qty))
  invalid(() => cumulative(kit('99999999.9999', 101, [100]), 0))
})
test('zero original quantity, fractional kits, reversed batches and quantities past the source reject', () => {
  invalid(() => cumulative(kit(0, 0, [0]), 0))
  invalid(() => cumulative(ordinary(0, 0), 0))
  invalid(() => cumulative(kit(0, 1.5, [0]), 0))
  invalid(() => cumulative(kit(0, 3, [0]), 1.5))
  invalid(() => batch(kit(1, 3, [300]), 2, 1))
  invalid(() => batch(kit(1, 3, [300]), 0, 4))
  invalid(() => call('projectCommercialBatch', kit(1, 1, [100]), null))
})
test('source-specific hinge refund uses frozen 80 rather than merged physical average 120', () => {
  assert.deepEqual(refund(80, 1, 0, 1), { refundCents: 8000, refundAmount: 80, cumulativeCents: 8000, cumulativeAmount: 80 })
})
test('one-cent source with three pieces refunds exactly one cent across three qualified returns', () => {
  const results = [1, 2, 3].map(q => refund('0.0100', 3, q - 1, q))
  assert.deepEqual(results.map(r => r.refundCents), [0, 1, 0])
  assert.deepEqual(results.map(r => r.cumulativeCents), [0, 1, 1])
  assert.equal(results.reduce((sum, r) => sum + r.refundCents, 0), 1)
})
test('refund supports zero budget, equal quantities, fractional goods and large exact quantities', () => {
  assert.equal(refund(0, 3, 0, 3).refundCents, 0)
  assert.equal(refund(1, 3, 0, 0).refundCents, 0)
  assert.equal(refund(1, 3, 2, 2).refundCents, 0)
  assert.equal(refund('0.01', '0.03', '0.01', '0.02').refundCents, 1)
  assert.equal(refund('9999999999.99', '9999999999.99', 0, '9999999999.99').refundCents, 999999999999)
  assert.equal(refund(1, '0.01', 0, '0.01').refundCents, 100)
  assert.doesNotThrow(() => JSON.stringify(refund(1, 3, 0, 3)))
})
test('refund rejects invalid basis, precision, overflow, reversed and excess qualified quantities', () => {
  invalid(() => call('projectCommercialRefund', null))
  for (const bad of [null, true, NaN, Infinity, -1, '0.001', '10000000000']) {
    invalid(() => refund(bad, 3, 0, 1))
    invalid(() => refund(1, bad, 0, 1))
    invalid(() => refund(1, 3, bad, 1))
    invalid(() => refund(1, 3, 0, bad))
  }
  invalid(() => refund(1, 0, 0, 0))
  invalid(() => refund(1, 3, 2, 1))
  invalid(() => refund(1, 3, 0, 4))
})
