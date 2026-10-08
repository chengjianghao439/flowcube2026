// Compile the real stylesheet and render real shared React controls in Chromium.
// Golden values: Chromium + Tailwind 3.4.19 + tailwind-merge 2.6.1. Original CSS/config
// match pre-migration 02446403a9f86470642115b432bcffb766417fea; original 896 values
// are retained verbatim. New edge and desktop interaction values use that same v3 compiler
// and original shared controls. Never refresh this golden file from v4.
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const { designBaseline } = require('./style-design-baseline.cjs')
const frontend = path.join(__dirname, '../../frontend')
const requireFrontend = createRequire(path.join(frontend, 'package.json'))
const { build } = requireFrontend('esbuild')
const postcss = requireFrontend('postcss')
const golden = path.join(__dirname, '../../tests/fixtures/frontend-style-v3.json')
const fixture = path.join(__dirname, 'style-compat-fixture.tsx')
const temporary = mkdtempSync(path.join(tmpdir(), 'flowcube-style-compat-'))
const session = `flowcube-style-compat-${process.pid}`
const cli = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 45000 })
const evaluate = expression => JSON.parse(cli('eval', expression, '--json')).data.result
const ids = ['title', 'input', 'primary', 'secondary', 'pda', 'badge', 'card', 'surface', 'success', 'warning', 'first', 'second', 'palette', 'dialog']
const props = ['backgroundColor', 'color', 'borderColor', 'borderWidth', 'borderRadius', 'fontSize', 'fontWeight', 'lineHeight', 'height', 'paddingTop', 'paddingLeft', 'marginTop', 'marginBottom', 'outlineStyle', 'outlineWidth', 'boxShadow']
const edges = ['hidden-y-first', 'hidden-y-second', 'hidden-x-first', 'hidden-x-second', 'responsive-y-first', 'responsive-y-second', 'responsive-x-first', 'responsive-x-second', 'margin-first', 'margin-second', 'reverse-y-first', 'reverse-y-second', 'reverse-x-first', 'reverse-x-second', 'divide-y-first', 'divide-y-second', 'responsive-divide-first', 'responsive-divide-second', 'reverse-divide-first', 'reverse-divide-second']
const edgeProps = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'width', 'height', 'relativeTop', 'relativeLeft']
const interactionProps = ['backgroundColor', 'color', 'borderColor', 'outlineStyle', 'outlineWidth', 'outlineOffset', 'boxShadow']
const selectors = Object.fromEntries([...ids, ...edges].map(id => [id, `#${id}`]))
for (let i = 0; i < 3; i++) selectors[`summary-${i}`] = `#summary dl > div:nth-child(${i + 1})`
const normalTargets = Object.fromEntries(ids.map(id => [id, props]))
for (const id of [...edges, 'summary-0', 'summary-1', 'summary-2']) normalTargets[id] = edgeProps

function capture(targets) {
  return evaluate(`(() => {
    const targets = ${JSON.stringify(targets)}, selectors = ${JSON.stringify(selectors)};
    return Object.fromEntries(Object.entries(targets).map(([id, props]) => {
      const element = document.querySelector(selectors[id]);
      if (!element) throw new Error('Missing style fixture ' + id);
      const style = getComputedStyle(element), box = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
      const geometry = { relativeTop: (box.top - parent.top) + 'px', relativeLeft: (box.left - parent.left) + 'px' };
      return [id, Object.fromEntries(props.map(prop => [prop, geometry[prop] ?? style[prop]]))];
    }));
  })()`)
}

function settle() {
  cli('wait', '--fn', 'document.getAnimations().every(a => a.playState !== "running")')
}

async function captureStates() {
  const actual = {}
  for (const width of [1280, 375]) {
    cli('set', 'viewport', String(width), '900')
    for (const dark of [false, true]) {
      evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      settle()
      actual[`${width}-${dark ? 'dark' : 'light'}`] = capture(normalTargets)
    }
  }
  cli('find', 'role', 'button', 'click', '--name', '关闭', '--exact')
  cli('wait', '--fn', '!document.getElementById("dialog")')
  cli('set', 'viewport', '1280', '900')
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light'
    evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
    for (const id of ['primary', 'secondary', 'pda']) {
      cli('hover', `#${id}`)
      settle()
      const hover = evaluate(`({ element: document.getElementById('${id}').matches(':hover'), capability: matchMedia('(hover: hover)').matches })`)
      assert.deepEqual(hover, { element: true, capability: true }, 'Desktop mouse hover must be real: ' + JSON.stringify(hover))
      actual[`1280-${theme}-hover-${id}`] = capture({ [id]: interactionProps })
    }
    cli('mouse', 'move', '1', '1')
    for (const id of ['input', 'primary']) {
      cli('focus', `#${id}`)
      // Keyboard input selects the focus-visible modality rather than forcing a pseudo class.
      cli('press', 'Tab')
      cli('press', 'Shift+Tab')
      settle()
      assert.equal(evaluate(`document.activeElement.id === '${id}' && document.activeElement.matches(':focus-visible')`), true, 'Keyboard focus must be visible')
      actual[`1280-${theme}-focus-${id}`] = capture({ [id]: interactionProps })
    }
  }
  return actual
}

// Convert both serializations through one sRGB canvas. No pixel tolerance is allowed.
function normalizeColors(values) {
  return evaluate(`(() => {
    const values = ${JSON.stringify(values)};
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    for (const controls of Object.values(values)) for (const styles of Object.values(controls)) {
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        if (!(prop in styles)) continue;
        context.clearRect(0, 0, 1, 1); context.fillStyle = styles[prop]; context.fillRect(0, 0, 1, 1);
        styles[prop] = Array.from(context.getImageData(0, 0, 1, 1).data);
      }
    }
    return values;
  })()`)
}

function normalizeShadow(value) {
  // v4 adds transparent, zero-size placeholders for unused shadow/ring slots.
  const visible = value.replaceAll(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(?:, |$)/g, '').replace(/, $/, '')
  return visible || 'none'
}

function compare(expected, actual) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'Every captured state needs v3 golden values')
  for (const state of Object.keys(actual)) {
    assert.deepEqual(Object.keys(actual[state]).sort(), Object.keys(expected[state]).sort(), 'Every fixture control needs v3 golden values')
    for (const id of Object.keys(actual[state])) assert.deepEqual(Object.keys(actual[state][id]).sort(), Object.keys(expected[state][id]).sort(), 'Every measured property needs v3 golden values')
  }
  const expectedColors = normalizeColors(expected), actualColors = normalizeColors(actual)
  let comparisons = 0
  const differences = []
  for (const [state, controls] of Object.entries(expected)) {
    for (const [id, styles] of Object.entries(controls)) {
      for (const [prop, value] of Object.entries(styles)) {
        comparisons++
        const received = actual[state]?.[id]?.[prop]
        let equal
        if (prop.endsWith('Color') || prop === 'color') equal = JSON.stringify(actualColors[state]?.[id]?.[prop]) === JSON.stringify(expectedColors[state][id][prop])
        else if (prop === 'boxShadow') equal = normalizeShadow(received || '') === normalizeShadow(value)
        else equal = received === value
        if (!equal) differences.push({ state, id, prop, expected: value, actual: received })
      }
    }
  }
  return { comparisons, differences }
}

// agent-browser 0.36 core guide, references/streaming.md: input_touch messages.
// This is modern Chromium touch simulation; device emulation can retain hover capability.
async function verifyTouchAction() {
  cli('set', 'device', 'iPhone 14')
  cli('scrollintoview', '#pda')
  const box = evaluate(`(() => { const b = document.getElementById('pda').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`)
  const before = Number(cli('get', 'text', '#actions').trim())
  const status = JSON.parse(cli('stream', 'status', '--json')).data
  const socket = new WebSocket(`ws://127.0.0.1:${status.port}`)
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Touch stream did not open within 5s')), 5000)
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Touch stream connection failed')) }, { once: true })
    })
    socket.send(JSON.stringify({ type: 'input_touch', eventType: 'touchStart', touchPoints: [{ ...box, id: 1, radiusX: 1, radiusY: 1, force: 1 }] }))
    socket.send(JSON.stringify({ type: 'input_touch', eventType: 'touchEnd', touchPoints: [] }))
    // Stream input is asynchronous. Wait for the real React handler to consume the trusted touch.
    await new Promise(resolve => setTimeout(resolve, 100))
    cli('wait', '--fn', `document.getElementById('actions').textContent === '${before + 1}'`)
    assert.equal(evaluate(`document.getElementById('actions').dataset.pointer`), 'touch')
    return { pointerType: 'touch', actions: 1, hoverCapability: evaluate('matchMedia("(hover: hover)").matches') }
  } finally {
    await new Promise(resolve => {
      if (socket.readyState === WebSocket.CLOSED) { resolve(); return }
      const timeout = setTimeout(resolve, 2000)
      socket.addEventListener('close', () => { clearTimeout(timeout); resolve() }, { once: true })
      socket.close()
    })
  }
}

async function main() {
  let browserStarted = false
  try {
    process.chdir(frontend)
    const config = (await import(pathToFileURL(path.join(frontend, 'postcss.config.js')))).default
    const plugins = Object.entries(config.plugins).map(([name, options]) => requireFrontend(name)(options))
    // Preserve the original v3 candidate set. These two recorded text utilities
    // were retired from product pages by F12; keep testing their compilation.
    // Adding all main candidates would alter historically un-emitted palette
    // utilities, so only the existing edge section adds further candidates.
    const fixtureClasses = ['text-success text-warning', ...[...readFileSync(fixture, 'utf8').split('<section')[1].matchAll(/className="([^"]*)"/g)].map(match => match[1])].join(' ')
    const source = readFileSync(path.join(frontend, 'src/index.css'), 'utf8') + `\n@source inline("${fixtureClasses}");`
    const css = await postcss(plugins).process(source, { from: path.join(frontend, 'src/index.css') })
    const result = await build({ entryPoints: [fixture], bundle: true, write: false, format: 'iife', jsx: 'automatic', tsconfig: path.join(frontend, 'tsconfig.app.json'), nodePaths: [path.join(frontend, 'node_modules')], define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{}', 'import.meta.hot': 'undefined' } })
    const htmlPath = path.join(temporary, 'index.html')
    writeFileSync(htmlPath, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css.css + '</style><div id="root"></div><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script>')
    browserStarted = true
    // Linux headless Chromium may report hover:none without a host mouse.
    // Use the desktop hover setting used by Playwright's Chromium launcher; actual
    // mouse input and :hover remain asserted, and touch below stays a simulation.
    cli('--allow-file-access', '--args', '--blink-settings=primaryHoverType=2', 'open', pathToFileURL(htmlPath).href)
    cli('wait', '--fn', 'Boolean(window.__styleReady)')
    const actual = await captureStates()
    const expected = designBaseline(JSON.parse(readFileSync(golden, 'utf8')))
    const report = compare(expected, actual)
    console.log(JSON.stringify(report, null, 2))
    assert.equal(report.differences.length, 0, 'Shared control styles differ from pre-migration baseline')
    const touch = await verifyTouchAction()
    // The real Dialog also opens/closes through its accessible buttons.
    cli('click', '#open-dialog')
    cli('wait', '#dialog')
    cli('wait', '--fn', 'getComputedStyle(document.getElementById("dialog")).pointerEvents === "auto"')
    settle()
    cli('find', 'role', 'button', 'click', '--name', '关闭', '--exact')
    cli('wait', '--fn', '!document.getElementById("dialog")')
    console.log(JSON.stringify({ touch, dialogOpenClose: true }))
  } catch (error) {
    if (browserStarted) {
      try { console.error(cli('errors')); console.error(cli('snapshot')) } catch (diagnosticError) { console.error(diagnosticError.message) }
    }
    throw error
  } finally {
    try {
      if (browserStarted) {
        cli('close')
        let sessions = ''
        for (let i = 0; i < 20; i++) {
          sessions = execFileSync('agent-browser', ['session', 'list', '--json'], { encoding: 'utf8' })
          if (!sessions.includes(session)) break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        assert(!sessions.includes(session), 'Owned style browser session did not exit')
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
