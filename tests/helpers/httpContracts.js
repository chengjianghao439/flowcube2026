'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { ts, parse, visit, callName, literals, filesUnder } = require('./contractSource')
const root = path.resolve(__dirname, '../..')
const frontend = path.join(root, 'frontend/src')
const bridge = 'components/desktop/DesktopPrintClientBridge.tsx'
const methods = new Set(['get', 'post', 'patch', 'put', 'delete'])

function normalize(route) {
  return route.replace(/\$\{[^}]*\}/g, ':p').split('?')[0].replace(/:\w+/g, ':p').replace(/\/+$/, '') || '/'
}

function callsInSource(file, source) {
  if (!source.includes('client') && !source.includes('Client')) return []
  const tree = parse(source, file)
  const clients = new Set()
  const calls = []
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue
    const moduleName = statement.moduleSpecifier.text
    if (!(moduleName === '@/api/client' || (moduleName.startsWith('.') && path.posix.normalize(path.posix.join(path.posix.dirname(file), moduleName)) === 'api/client'))) continue
    const clause = statement.importClause
    if (clause.name) clients.add(clause.name.text)
    for (const spec of clause.namedBindings?.elements || []) {
      if (!spec.isTypeOnly && (spec.propertyName || spec.name).text === 'payloadClient') clients.add(spec.name.text)
    }
  }
  visit(tree, node => {
    let method = callName(node)
    if (!method) return
    if (file === bridge && method === 'reportPrintOutcomeWithRetry') method = 'post'
    else if (!methods.has(method) || !ts.isPropertyAccessExpression(node.expression)
      || !clients.has(node.expression.expression.getText())) return
    const url = node.arguments[0]
    if (!url || !literals(url)?.startsWith('/')) return
    // 动态业务动作名由 sale-commercial 的逐动作运行测试覆盖。
    if (file === 'api/sale-commercial.ts' && literals(url).includes('${op.action}')) return
    let paths = [literals(url)]
    if (ts.isTemplateExpression(url)) {
      paths = [url.head.text]
      for (const span of url.templateSpans) {
        const expr = span.expression
        const parts = ts.isConditionalExpression(expr) && ts.isStringLiteralLike(expr.whenTrue) && ts.isStringLiteralLike(expr.whenFalse)
          ? [expr.whenTrue.text, expr.whenFalse.text] : [':p']
        paths = paths.flatMap(p => parts.map(part => p + part + span.literal.text))
      }
    }
    const config = node.arguments[['get', 'delete'].includes(method) ? 1 : 2]
    method = method.toUpperCase()
    for (const route of paths) calls.push({ key: method + ' ' + normalize('/api' + route), raw: method + ' ' + route, file, config })

  })
  return calls
}

function frontendCalls() {
  const files = filesUnder(frontend, name => /\.tsx?$/.test(name) && !/\.(test|spec|d)\.tsx?$/.test(name))
  const calls = files.flatMap(full => callsInSource(path.relative(frontend, full), fs.readFileSync(full, 'utf8')))
  return { calls, files: files.length }
}

function backendRoutes() {
  const routes = new Map()
  const app = path.join(root, 'backend/src/app.js')
  const parsed = new Map()
  let mounts = 0
  function tree(file) {
    if (!parsed.has(file)) parsed.set(file, parse(fs.readFileSync(file, 'utf8'), file))
    return parsed.get(file)
  }
  function collect(file, receiver, prefix, inheritedPda = false) {
    let gated = inheritedPda
    visit(tree(file), node => {
      const method = callName(node)
      if (!method || !ts.isPropertyAccessExpression(node.expression) || node.expression.expression.getText() !== receiver) return
      const [first, ...rest] = node.arguments
      if (method === 'use' && first && ts.isIdentifier(first) && first.text === 'pdaOnly') gated = true
      if (!first || !ts.isStringLiteralLike(first) || (!methods.has(method) && method !== 'use')) return
      const full = prefix + first.text
      const pdaOnly = gated || rest.slice(0, -1).some(arg => ts.isIdentifier(arg) && arg.text === 'pdaOnly')
      if (method !== 'use') return void routes.set(method.toUpperCase() + ' ' + normalize(full), { file, pdaOnly })
      const child = rest.at(-1)
      if (child && callName(child) === 'require' && ts.isStringLiteralLike(child.arguments[0])) {
        if (file === app) {
          if (!full.startsWith('/api')) return
          mounts++
        }
        collect(require.resolve(path.resolve(path.dirname(file), child.arguments[0].text)), 'router', full, pdaOnly)
      } else if (child && ts.isIdentifier(child) && file !== app) collect(file, child.text, full, pdaOnly)
    })
  }
  collect(app, 'app', '')
  return { routes, mounts }
}

module.exports = { normalize, backendRoutes, callsInSource, frontendCalls, bridge }
