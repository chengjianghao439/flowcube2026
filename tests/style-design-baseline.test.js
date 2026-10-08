const { test } = require('node:test')
const assert = require('node:assert/strict')
const golden = require('./fixtures/frontend-style-v3.json')
const { designBaseline } = require('../scripts/browser-smoke/style-design-baseline.cjs')

test('reviewed F12 change touches exactly nine dark text colors, leaving v3 golden immutable', () => {
  const original = JSON.stringify(golden), updated = designBaseline(golden), changes = []
  for (const [state, controls] of Object.entries(golden)) for (const [id, props] of Object.entries(controls)) {
    for (const [prop, value] of Object.entries(props)) if (updated[state][id][prop] !== value) changes.push({ state, id, prop, value: updated[state][id][prop] })
  }
  assert.equal(changes.length, 9)
  assert.ok(changes.every(change => change.state.includes('dark') && change.prop === 'color' && change.value === 'rgb(1, 2, 4)'))
  assert.equal(JSON.stringify(golden), original)
  assert.equal(updated['1280-light'].primary.color, golden['1280-light'].primary.color)
  assert.equal(updated['1280-dark'].primary.backgroundColor, golden['1280-dark'].primary.backgroundColor)
})
test('missing or previously changed golden slots cannot be silently approved', () => {
  for (const value of ['rgb(200, 0, 0)', undefined]) {
    const changed = JSON.parse(JSON.stringify(golden)); changed['1280-dark'].primary.color = value
    assert.throws(() => designBaseline(changed), /Reviewed v3 color slot changed/)
  }
})
