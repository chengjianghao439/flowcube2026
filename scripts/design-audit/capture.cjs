'use strict'
// Actual browser capture of registered routes. Capture is evidence, not a visual pass.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const stage = process.argv[2] || 'before'
if (!['before', 'after'].includes(stage)) throw new Error('invalid stage')
const dir = path.join(root, 'docs/design-audit-2026-10-08')
const session = 'flowcube-impeccable-capture'
const base = process.env.FLOWCUBE_DESIGN_AUDIT_URL
if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('loopback preview required')
const cli = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 45000 })
const routes = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'))).routes
const output = path.join(dir, `observations-${stage}.json`)
const observations = process.argv[3] === 'append' && fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : []
const dynamicFile = path.join(dir, 'dynamic-fixtures.json')
const dynamic = fs.existsSync(dynamicFile) ? JSON.parse(fs.readFileSync(dynamicFile)) : []
const targets = [...routes.filter(route => route.route && !route.route.includes(':') && !route.route.startsWith('/pda') && ['static', 'new', 'authentication', 'public', 'alias'].includes(route.kind)).map(route => ({ ...route, path: route.path || route.route })), ...dynamic.map(item => ({ ...routes.find(route => route.route === item.route), path: item.path }))]
try {
  cli('open', base + '/#/dashboard')
  cli('set', 'viewport', '1440', '900')
  for (const route of targets) {
    if (observations.some(item => item.route === route.path)) continue
    const slug = route.path.slice(1).replaceAll('/', '-') || 'home'
    const screenshot = `screens/${stage}/route-${slug}.png`
    try {
      cli('open', base + '/#' + route.path)
      cli('wait', '--load', 'networkidle')
      const result = JSON.parse(cli('eval', `(() => {
        const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
        return { url:location.hash, headings:[...document.querySelectorAll('h1,h2')].filter(visible).map(e=>e.innerText),
          body:document.body.innerText.slice(-18000), rows:[...document.querySelectorAll('tbody tr')].filter(visible).length,
          overflow:document.documentElement.scrollWidth>innerWidth,
          dialogs:[...document.querySelectorAll('[role="dialog"]')].filter(visible).map(e=>e.innerText.slice(0,1000)) };
      })()`, '--json')).data.result
      cli('screenshot', path.join(dir, screenshot))
      observations.push({ routeKey: route.routeKey, route: route.path, pattern: route.route, source: route.source, category: route.category, stage, viewport: '1440x900', theme: 'light', capturedAt: new Date().toISOString(), screenshot, ...result, visualReview: '截图待人工查看', testResult: '本次仅捕获页面，不等于行为通过' })
      console.log(`[capture] ${observations.length} ${route.path} rows=${result.rows} overflow=${result.overflow}`)
    } catch (error) {
      observations.push({ routeKey: route.routeKey, route: route.path, stage, error: error.message.slice(0,500), visualReview: '未验证' })
      console.log(`[capture] failed ${route.path}`)
    }
    fs.writeFileSync(output, JSON.stringify(observations, null, 2) + '\n')
  }
} finally {
  cli('close')
  let sessions
  for (let attempt = 0; attempt < 5; attempt++) {
    // close acknowledges before the owned daemon exits; list is a global read.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    sessions = JSON.parse(execFileSync('agent-browser', ['session', 'list', '--json'], { encoding: 'utf8' }))
    if (!sessions.data.sessions.includes(session)) break
  }
  fs.writeFileSync(path.join(dir, `capture-cleanup-${stage}.json`), JSON.stringify(sessions, null, 2) + '\n')
  if (JSON.stringify(sessions).includes(session)) throw Error('owned capture session remains after close; inspect this session only')
}
