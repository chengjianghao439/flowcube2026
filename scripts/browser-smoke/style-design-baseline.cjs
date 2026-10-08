const assert = require('node:assert/strict')

// F12: dark blue button text intentionally gains AA contrast. Keep immutable
// v3 compiler goldens and approve only these nine exact, reviewed color slots.
const slots = [
  ['1280-dark', 'badge'], ['1280-dark', 'pda'], ['1280-dark', 'primary'],
  ['375-dark', 'badge'], ['375-dark', 'pda'], ['375-dark', 'primary'],
  ['1280-dark-hover-primary', 'primary'], ['1280-dark-hover-pda', 'pda'],
  ['1280-dark-focus-primary', 'primary'],
]
function designBaseline(golden) {
  const updated = JSON.parse(JSON.stringify(golden))
  for (const [state, id] of slots) {
    assert.equal(updated[state]?.[id]?.color, 'rgb(15, 23, 42)', `Reviewed v3 color slot changed: ${state}/${id}`)
    updated[state][id].color = 'rgb(1, 2, 4)'
  }
  return updated
}
module.exports = { designBaseline }
