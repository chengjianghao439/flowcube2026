const { test } = require('node:test')
const assert = require('node:assert/strict')
const golden = require('./fixtures/frontend-style-v3.json')
const { legacyDesignBaseline: designBaseline, designBaseline: desktopBaseline } = require('../scripts/browser-smoke/style-design-baseline.cjs')

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
test('approved desktop projection changes only its 96 exact light material slots', () => {
  const original = JSON.stringify(golden), legacy = designBaseline(golden), updated = desktopBaseline(golden)
  const changes = []
  for (const [state, controls] of Object.entries(legacy)) for (const [id, props] of Object.entries(controls)) {
    for (const [prop, value] of Object.entries(props)) if (updated[state][id][prop] !== value) changes.push({ state, id, prop })
  }
  assert.equal(changes.length, 96)
  assert.ok(changes.every(({ state, prop }) => state.includes('light') && ['backgroundColor', 'color', 'borderColor', 'borderRadius', 'boxShadow'].includes(prop)))
  assert.equal(JSON.stringify(golden), original)
  const changed = structuredClone(golden)
  changed['1280-light'].primary.backgroundColor = 'rgb(200, 0, 0)'
  assert.throws(() => desktopBaseline(changed), /Reviewed desktop slot changed/)
})

test('ERP 顶栏叠菜单位于列宽调节手柄上方并低于模态遮罩', () => {
  const read = path => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', path), 'utf8')
  const css = read('frontend/src/styles/desktop-page-samples.css')
  const resize = read('frontend/src/components/shared/TableColumnResizeHandle.tsx')
  const dialog = read('frontend/src/components/ui/dialog.tsx')
  const headerLayer = Number(css.match(/--desktop-layer-header:\s*(\d+)/)?.[1])
  const resizeLayer = Number(resize.match(/right-0 z-(\d+)/)?.[1])
  const overlayLayer = Number(dialog.match(/fc-dialog-overlay fixed inset-0 z-(\d+)/)?.[1])
  assert.ok(resizeLayer < headerLayer && headerLayer < overlayLayer)
  assert.match(css, /\.fc-topnav-menu > ul\s*\{[^}]*max-height:\s*var\(--topnav-menu-height/)
  assert.match(css, /\.fc-topnav-menu > ul\s*\{[^}]*overflow-y:\s*auto/)
})

test('ERP 工作区 Toast 层级在列宽手柄和顶栏之间', () => {
  const read = path => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', path), 'utf8')
  const css = read('frontend/src/styles/desktop-page-samples.css')
  const resize = read('frontend/src/components/shared/TableColumnResizeHandle.tsx')
  const headerLayer = Number(css.match(/--desktop-layer-header:\s*(\d+)/)?.[1])
  const toastLayer = Number(css.match(/\.desktop-shell-sample\s*\{\s*--desktop-layer-toast:\s*(\d+)/)?.[1])
  const resizeLayer = Number(resize.match(/right-0 z-(\d+)/)?.[1])
  assert.ok(resizeLayer < toastLayer && toastLayer < headerLayer)
})

test('ERP 临时浮层使用菜单阴影，层叠对话框只让最上方遮罩着色', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../frontend/src/styles/desktop-page-samples.css'), 'utf8')
  assert.match(css, /\[data-radix-popper-content-wrapper\] > :is\(\[role="menu"\],\[role="listbox"\],\[role="dialog"\]\)\s*\{[^}]*box-shadow:\s*var\(--desktop-shadow-menu\)/)
  assert.match(css, /\[data-radix-popper-content-wrapper\] :is\(\[role="menu"\],\[role="listbox"\]\)\s*\{[^}]*box-shadow:\s*var\(--desktop-shadow-menu\)/)
  assert.match(css, /body:has\(\.desktop-shell-sample\) > \.fc-dialog-overlay:has\(~ \.fc-dialog-overlay\)\s*\{[^}]*background:\s*transparent/)
})
