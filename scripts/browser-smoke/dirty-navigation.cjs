/** Actual Chromium file:// + real HashRouter integration. Own named browser is always closed. */
const { build } = require('../../frontend/node_modules/esbuild')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const session = `flowcube-dirty-navigation-${process.pid}`
const temporary = mkdtempSync(path.join(tmpdir(), 'flowcube-navigation-'))
const cli = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 45000 })
async function main() {
  try {
    const result = await build({
      entryPoints: [path.join(__dirname, 'dirty-navigation-fixture.tsx')], bundle: true, write: false,
      format: 'iife', jsx: 'automatic', tsconfig: path.join(__dirname, '../../frontend/tsconfig.app.json'),
      nodePaths: [path.join(__dirname, '../../frontend/node_modules')],
      define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{}', 'import.meta.hot': 'undefined' },
      plugins: [{ name: 'isolated-pages', setup(build) {
        build.onResolve({ filter: /^@\/router\/routeRegistry$/ }, () => ({ path: 'routes', namespace: 'fixture' }))
        build.onResolve({ filter: /^@\/hooks\/usePermission$/ }, () => ({ path: 'permission', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: name === 'routes'
          ? 'export const PATH_TITLES={}; export const isRegisteredErpRoute=()=>true; export const resolveRouteComponent=()=>null; export const resolveRoutePermission=()=>null; export const resolveRouteTitle=(path)=>path;'
          : 'export const usePermission=()=>({can:()=>true});' }))
      } }],
    })
    const htmlPath = path.join(temporary, 'index.html')
    writeFileSync(htmlPath, '<!doctype html><div id="root"></div><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script>')
    cli('--allow-file-access', 'open', pathToFileURL(htmlPath).href + '?client=desktop#/dashboard?from=list')
    cli('wait', '--fn', 'Boolean(window.__navigationResult)')
    const reply = JSON.parse(cli('eval', 'window.__navigationResult', '--json'))
    const outcome = reply.data?.result
    console.log(JSON.stringify(outcome, null, 2))
    if (outcome?.status !== 'passed') process.exitCode = 1
  } finally {
    console.log(cli('close').trim())
    let sessions = ''
    for (let i = 0; i < 20; i++) {
      sessions = execFileSync('agent-browser', ['session', 'list', '--json'], { encoding: 'utf8' })
      if (!sessions.includes(session)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (sessions.includes(session)) throw new Error('本任务浏览器会话仍未关闭: ' + session)
    console.log('Owned browser session closed and absence verified.')
    rmSync(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
