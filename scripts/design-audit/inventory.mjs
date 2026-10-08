#!/usr/bin/env node
/**
 * Current frontend implementation inventory, not a GUI acceptance report.
 * Reads only frontend/src source files and its own generated coverage.json.
 * Never loads application modules, env files, deploy config, DB, or browsers.
 * Run with Node 22 after frontend dependencies are installed:
 *   node scripts/design-audit/inventory.mjs
 *   node scripts/design-audit/inventory.mjs --check
 * --check checks that the generated inventories are current; it is not a product test.
 * Review fields survive reruns by route/call identity. Their source snapshot is
 * recorded separately, so rerunning cannot promote source inventory to acceptance.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { serializeInventory } from './serialize-inventory.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const srcRoot = path.join(root, 'frontend/src')
const outDir = path.join(root, 'docs/design-audit-2026-10-08')
const outputFile = path.join(outDir, 'coverage.json')
const require = createRequire(path.join(root, 'frontend/package.json'))
const ts = require('typescript')
const STATES = ['loading', 'empty', 'error', 'denied', 'disabled', 'success', 'unknown']
const GROUPS = ['销售', '采购', '库存仓储', '财务会计', '基础资料', '审批待办', '打印物流', '系统设置', 'PDA']
const bySource = new Map()
const slash = value => value.split(path.sep).join('/')
const relative = value => slash(path.relative(root, value))
const compact = value => value.replace(/\s+/g, ' ').trim().slice(0, 220)
const sourceOf = node => node.getSourceFile()
const where = node => ({ source: relative(sourceOf(node).fileName), line: sourceOf(node).getLineAndCharacterOfPosition(node.getStart()).line + 1 })
function visit(node, fn) { fn(node); ts.forEachChild(node, child => visit(child, fn)) }
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return ['__tests__', '__fixtures__', 'generated', 'assets'].includes(entry.name) ? [] : listFiles(full)
    return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec|test-data|d)\./.test(entry.name) ? [full] : []
  }).sort()
}
function safeRead(file) {
  if (!file.startsWith(srcRoot + path.sep) || /(?:^|\/)(?:\.env|production[^/]*|secrets?)(?:\/|$)/i.test(file)) throw new Error(`Source outside allowlist: ${file}`)
  return fs.readFileSync(file, 'utf8')
}
function prop(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined
  return node.properties.find(p => ts.isPropertyAssignment(p) && propertyName(p.name) === name)?.initializer
}
function propertyName(node) { return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : node.getText() }
function literal(node) {
  if (!node) return undefined
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(p => [propertyName(p.name), literal(p.initializer)]))
  return compact(node.getText())
}
function declaration(sf, name) {
  let result
  visit(sf, node => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) result = node.initializer })
  return result
}
function resolveModule(from, module) {
  if (!module.startsWith('@/') && !module.startsWith('.')) return undefined
  const base = module.startsWith('@/') ? path.join(srcRoot, module.slice(2)) : path.resolve(path.dirname(from), module)
  return [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map(suffix => base + suffix)]
    .find(file => bySource.has(relative(file)))
}
function importIn(node) {
  let result
  visit(node, child => {
    if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(child.arguments[0])) result = child.arguments[0].text
  })
  return result
}
function tagName(node) { return node.tagName.getText() }
function jsxAttrs(node) {
  return Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [propertyName(attr.name), attr.initializer ? (ts.isJsxExpression(attr.initializer) ? compact(attr.initializer.expression?.getText() ?? '') : literal(attr.initializer)) : true]))
}
function jsxTags(node) {
  const output = []
  visit(node, child => { if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) output.push(child) })
  return output
}
function ownerFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isMethodDeclaration(current)) && current.name) return propertyName(current.name)
    if (ts.isArrowFunction(current) && ts.isVariableDeclaration(current.parent)) return propertyName(current.parent.name)
  }
  return null
}
function exportedBinding(file, name, seen = new Set()) {
  if (!file || seen.has(`${file}:${name}`)) return undefined
  seen.add(`${file}:${name}`)
  const info = bySource.get(file)
  for (const node of info.sf.statements) {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveModule(info.sf.fileName, node.moduleSpecifier.text)
      if (!target) continue
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const entry = node.exportClause.elements.find(item => item.name.text === name)
        if (entry) return exportedBinding(relative(target), entry.propertyName?.text ?? entry.name.text, seen) ?? { source: relative(target), exportName: entry.propertyName?.text ?? entry.name.text }
      } else if (!node.exportClause) {
        const resolved = exportedBinding(relative(target), name, seen)
        if (resolved) return resolved
      }
    }
  }
  if (info.hasJsx || info.sf.statements.some(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name)) return { source: file, exportName: name }
  return undefined
}
function definitionFor(info, tag) {
  const imported = info.imports.get(tag)
  if (imported) return imported.resolved ? exportedBinding(imported.resolved, imported.exportName) ?? { source: imported.resolved, exportName: imported.exportName } : { module: imported.module, exportName: imported.exportName }
  if (info.lazy.has(tag)) return { source: info.lazy.get(tag), exportName: 'default' }
  if (info.localBindings.has(tag)) return { source: info.source, exportName: tag, local: true }
  return undefined
}

for (const file of listFiles(srcRoot)) {
  const text = safeRead(file)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  if (sf.parseDiagnostics.length) throw new Error(`Cannot parse ${relative(file)}: ${sf.parseDiagnostics[0].messageText}`)
  const localBindings = new Set()
  visit(sf, node => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) localBindings.add(node.name.text)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) localBindings.add(node.name.text)
  })
  bySource.set(relative(file), { source: relative(file), sf, text, imports: new Map(), lazy: new Map(), localBindings, importEdges: [], hasJsx: jsxTags(sf).length > 0 })
}
for (const info of bySource.values()) {
  for (const node of info.sf.statements) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveModule(info.sf.fileName, node.moduleSpecifier.text)
      const resolved = target && relative(target)
      if (resolved) info.importEdges.push({ ...where(node), module: node.moduleSpecifier.text, target: resolved, kind: ts.isExportDeclaration(node) ? 'reexport' : 'import' })
      if (ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause
        if (clause.name) info.imports.set(clause.name.text, { module: node.moduleSpecifier.text, resolved, exportName: 'default' })
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const entry of clause.namedBindings.elements) info.imports.set(entry.name.text, { module: node.moduleSpecifier.text, resolved, exportName: entry.propertyName?.text ?? entry.name.text })
      }
    }
  }
  visit(info.sf, node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      const target = resolveModule(info.sf.fileName, node.arguments[0].text)
      if (target) info.importEdges.push({ ...where(node), module: node.arguments[0].text, target: relative(target), kind: 'dynamic-import' })
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const module = importIn(node.initializer)
      const target = module && resolveModule(info.sf.fileName, module)
      if (target) info.lazy.set(node.name.text, relative(target))
    }
  })
}

const routeDefinitions = bySource.get('frontend/src/router/routeDefinitions.ts')
const componentRegistry = bySource.get('frontend/src/router/routeRegistry.ts')
const mergedInfo = bySource.get('frontend/src/components/shared/MergedPage.tsx')
const components = declaration(componentRegistry.sf, 'components')
const componentSources = new Map(components.properties.filter(ts.isPropertyAssignment).map(node => {
  const module = importIn(node.initializer)
  const file = module ? resolveModule(componentRegistry.sf.fileName, module) : path.join(srcRoot, 'components/shared/MergedPage.tsx')
  return [propertyName(node.name), { source: relative(file), evidence: where(node) }]
}))
const viewSources = new Map(declaration(mergedInfo.sf, 'views').properties.filter(ts.isPropertyAssignment).map(node => [propertyName(node.name), relative(resolveModule(mergedInfo.sf.fileName, importIn(node.initializer)))]))
const mergedGroups = literal(declaration(bySource.get('frontend/src/router/mergedPageGroups.ts').sf, 'MERGED_PAGE_GROUPS'))
const warehousePage = bySource.get('frontend/src/pages/warehouse-structure/index.tsx')
const warehousePaths = literal(declaration(warehousePage.sf, 'KEY_TO_PATH'))
const warehouseSources = Object.fromEntries(Object.entries(warehousePaths).map(([key, route]) => {
  const target = [...warehousePage.imports.values()].find(item => item.module === `@/pages/${key}`)
  return [route, target?.resolved]
}))
const pdaInfo = bySource.get('frontend/src/router/pdaRoutes.tsx')
const publicInfo = bySource.get('frontend/src/router/index.tsx')
const pdaNav = literal(declaration(bySource.get('frontend/src/pages/pda/index.tsx').sf, 'ALL_OPS'))
const dailyNav = literal(declaration(bySource.get('frontend/src/components/shared/DailyWork.tsx').sf, 'DAILY_GROUPS'))
const routes = []
function category(route) {
  if (route.startsWith('/pda')) return 'PDA'
  if (/^\/(products|kits|categories|price-change|customers|suppliers)(\/|$)/.test(route)) return '基础资料'
  if (/^\/(approvals|dashboard)|^\/reports\/role-workbench/.test(route)) return '审批待办'
  if (/^\/(logistics|carriers|carrier-accounts)|^\/settings\/(barcode-print-query|print-templates|printers)/.test(route)) return '打印物流'
  if (/^\/(payments|finance|accounting|refunds|supplier-refunds|portal)|^\/reports\/(reconciliation|profit-analysis|kpi|avg-cost-reconciliation)/.test(route) || route === '/reports') return '财务会计'
  if (/^\/(purchase|purchase-requisitions|procurement)|^\/returns\/purchase|^\/reports\/replenishment/.test(route)) return '采购'
  if (/^\/(sale|credit-overrides)|^\/returns\/sale/.test(route)) return '销售'
  if (/^\/(inventory|plastic-boxes|stockcheck|disposals|transfer|inbound-tasks|picking-waves|warehouses|locations|racks|sorting-bins)|^\/reports\/(inventory-aging|warehouse-ops|wave-performance|pda-anomaly)/.test(route)) return '库存仓储'
  return '系统设置'
}
function purpose(route, title, kind) {
  if (kind === 'alias') return `兼容旧地址，重定向至 ${route}`
  if (kind === 'authentication') return `本人原请求结果核对；登录准入，原业务权限与写权限仍须按页面核查`
  if (route.endsWith('/new') || route === '/sale/new-kit') return `${title}；创建、录入与保存表面`
  if (route.includes(':id')) return `${title}；具体单据/记录详情、编辑或执行表面`
  if (route.startsWith('/pda')) return `${title}；PDA 工作台、扫码作业或设备入口`
  return `${title}；当前已注册页面或工作区子视图`
}
function titleFor(node, route) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isArrowFunction(node)) {
    let body = node.body
    if (ts.isConditionalExpression(body)) body = route.endsWith('/new') ? body.whenTrue : body.whenFalse
    if (ts.isStringLiteralLike(body)) return body.text
    if (ts.isTemplateExpression(body)) return body.head.text + body.templateSpans.map(span => {
      let value = '<id>'
      if (ts.isConditionalExpression(span.expression)) {
        const condition = span.expression.condition
        if (ts.isCallExpression(condition) && ts.isPropertyAccessExpression(condition.expression) && ts.isStringLiteral(condition.arguments[0])) {
          const operation = condition.expression.name.text
          if (['includes', 'startsWith', 'endsWith'].includes(operation)) value = literal(route[operation](condition.arguments[0].text) ? span.expression.whenTrue : span.expression.whenFalse)
        }
      }
      return value + span.literal.text
    }).join('')
  }
  return compact(node.getText())
}
function expandedPattern(text) {
  const pattern = text.replace(/^\//, '').replace(/\/[a-z]*$/, '').replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\\d\+/g, ':id')
  const group = /\(([^()]+)\)/.exec(pattern)
  return group ? group[1].split('|').map(option => pattern.replace(group[0], option)) : [pattern]
}
function addRoute(data) {
  const id = `route:${data.route}`
  if (routes.some(route => route.id === id)) return
  const group = mergedGroups.find(item => item.views.some(view => view.path === data.route))
  const actualSource = warehouseSources[data.route] ?? viewSources.get(data.route) ?? data.source
  routes.push({ id, ...data, path: data.kind === 'dynamic' ? null : data.route, pattern: data.routePattern ?? data.route, source: actualSource, rendererSource: data.source, category: category(data.aliasTarget ?? data.route), purpose: data.kind === 'fallback' ? '未知地址的路由回退；须独立验证，不作为可遍历业务页' : purpose(data.aliasTarget ?? data.route, data.page, data.kind), mergedWorkspace: group ? { key: group.key, title: group.title, view: group.views.find(view => view.path === data.route)?.label, allViews: group.views.map(view => view.path), permissionFiltered: true } : undefined })
}
for (const arrayName of ['routeRegistry', 'routePatterns', 'authenticationRoutes']) {
  const array = declaration(routeDefinitions.sf, arrayName)
  for (const node of array.elements) {
    const key = literal(prop(node, 'componentKey'))
    const definition = componentSources.get(key)
    if (!definition) throw new Error(`Missing component for ${key}`)
    const routePaths = arrayName === 'routePatterns' ? expandedPattern(prop(node, 'pattern').getText()) : [literal(prop(node, 'path'))]
    for (const route of routePaths) {
      const nav = literal(prop(node, 'nav'))
      const group = mergedGroups.find(item => item.views.some(view => view.path === route))
      addRoute({ route, page: titleFor(prop(node, 'title'), route), component: key, source: definition.source, kind: arrayName === 'routePatterns' ? (route.endsWith('/new') ? 'new' : 'dynamic') : arrayName === 'authenticationRoutes' ? 'authentication' : route.endsWith('/new') || route === '/sale/new-kit' ? 'new' : 'static', routeEvidence: where(node), componentEvidence: definition.evidence, routePattern: prop(node, 'pattern')?.getText(), permission: prop(node, 'permission')?.getText() ?? '登录认证', keepAlive: literal(prop(node, 'keepAlive')), tabIdentity: prop(node, 'tabIdentity')?.getText() === 'pathnameIdentity' ? { kind: 'pathname' } : literal(prop(node, 'tabIdentity')), listPath: literal(prop(node, 'listPath')), navigation: { hidden: !nav, mode: nav ? group && group.views[0].path !== route ? '合并工作区子视图（顶栏组项去重）' : '顶栏可见候选（按权限过滤）' : '无顶栏注册；按钮/来源跳转/直达', declaration: nav, dailyWork: dailyNav.filter(item => item.paths.includes(route)).map(item => item.title) } })
    }
    for (const alias of literal(prop(node, 'aliases')) ?? []) addRoute({ route: alias, page: `旧地址 → ${literal(prop(node, 'path'))}`, component: key, source: definition.source, kind: 'alias', aliasTarget: literal(prop(node, 'path')), routeEvidence: where(node), componentEvidence: definition.evidence, navigation: { hidden: true, mode: '旧地址兼容跳转' }, permission: prop(node, 'permission')?.getText() })
  }
}
function scanJsxRoutes(info, mode) {
  function walk(node, prefix = '') {
    if (ts.isJsxElement(node) && tagName(node.openingElement) === 'Route' || ts.isJsxSelfClosingElement(node) && tagName(node) === 'Route') {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const attrs = jsxAttrs(opening)
      const current = attrs.path ? (attrs.path.startsWith('/') ? attrs.path : attrs.path === '*' && !prefix ? '*' : `${prefix}/${attrs.path}`) : attrs.index ? prefix : prefix
      const elementAttr = opening.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.text === 'element')
      const tags = elementAttr ? jsxTags(elementAttr) : []
      const component = tags.find(tag => info.lazy.has(tagName(tag)))
      const navigate = tags.find(tag => tagName(tag) === 'Navigate')
      const landing = tags.find(tag => tagName(tag) === 'LandingGate')
      if ((attrs.path || attrs.index) && (component || navigate || landing)) {
        const componentKey = component ? tagName(component) : landing ? 'LandingPage' : 'Navigate'
        const source = component ? info.lazy.get(componentKey) : landing ? info.lazy.get('LandingPage') : info.source
        const permission = tags.find(tag => tagName(tag) === 'PdaRoutePermission')
        const permissionAttrs = permission ? jsxAttrs(permission) : undefined
        const nav = pdaNav.find(item => item.path === current)
        const aliasTarget = navigate ? jsxAttrs(navigate).to : undefined
        addRoute({ route: current, page: permissionAttrs?.title ?? nav?.label ?? (componentKey === 'PdaIndexPage' ? 'PDA 工作台' : componentKey === 'PdaLoginPage' ? 'PDA 登录' : componentKey === 'PdaBindPage' ? '设备绑定' : landing ? '官网入口' : componentKey === 'LoginPage' ? '系统登录' : componentKey === 'ForbiddenPage' ? '无访问权限' : `跳转 → ${aliasTarget}`), component: componentKey, source, kind: navigate ? current === '*' ? 'fallback' : 'alias' : mode === 'PDA' ? current.includes(':id') ? 'dynamic' : 'static' : 'public', routeEvidence: where(opening), aliasTarget, entryCondition: landing ? '无 hash 且非 file 协议显示官网；已有 hash 由 LandingGate 转系统登录' : undefined, permission: permissionAttrs?.required ?? (mode === 'PDA' ? current === '/pda/login' ? '游客；设备缓存水合闸门' : 'PDA 登录、设备绑定/会话守卫' : '游客/公开路由；见路由父守卫'), navigation: { hidden: !nav, mode: nav ? nav.more ? 'PDA 更多功能（按权限过滤）' : 'PDA 常用作业（按权限过滤）' : mode === 'PDA' ? 'PDA 子作业/条件入口/直达' : '公开/认证/回退入口', declaration: nav } })
      }
      if (ts.isJsxElement(node)) for (const child of node.children) walk(child, current)
      return
    }
    ts.forEachChild(node, child => walk(child, prefix))
  }
  walk(info.sf)
}
scanJsxRoutes(pdaInfo, 'PDA')
scanJsxRoutes(publicInfo, 'public')
routes.sort((a, b) => GROUPS.indexOf(a.category) - GROUPS.indexOf(b.category) || a.route.localeCompare(b.route))

// Physical module reachability is a source map only. An import is not evidence
// that a conditional component was rendered or that an action was exercised.
const roots = ['frontend/src/main.tsx', 'frontend/src/router/index.tsx', 'frontend/src/router/pda.tsx', ...routes.filter(route => !['alias', 'fallback'].includes(route.kind)).map(route => route.source)]
function closure(seeds, filter = () => true) {
  const seen = new Set()
  const queue = [...seeds]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file) || !bySource.has(file)) continue
    seen.add(file)
    for (const edge of bySource.get(file).importEdges) if (filter(edge, file)) queue.push(edge.target)
  }
  return seen
}
const reachable = closure(roots)
const excludedFiles = [...bySource.keys()].filter(file => !reachable.has(file))
const isUiFile = file => /\.(tsx|jsx)$/.test(file)
function uiClosure(route) {
  return closure([route.source], (edge, from) => {
    // Do not spread route registry or shared workspace wrapper to every page.
    if (edge.target.startsWith('frontend/src/router/')) return false
    if (from === 'frontend/src/pages/warehouse-structure/index.tsx' && edge.target.startsWith('frontend/src/pages/')) return edge.target === warehouseSources[route.route]
    if (from === 'frontend/src/components/shared/MergedPage.tsx' && edge.kind === 'dynamic-import') return edge.target === viewSources.get(route.route)
    return true
  })
}
const routeReachability = new Map(routes.filter(route => !['alias', 'fallback'].includes(route.kind)).map(route => [route.id, uiClosure(route)]))
const shellRoots = ['frontend/src/layouts/AppLayout.tsx', 'frontend/src/layouts/PdaLayout.tsx', 'frontend/src/components/GlobalErrorBoundary.tsx', 'frontend/src/components/erp/ErpDesktopConnectionGate.tsx', 'frontend/src/components/desktop/DesktopUpdateBridge.tsx', 'frontend/src/components/desktop/DesktopQuitUnloadBridge.tsx', 'frontend/src/components/desktop/DesktopPrintClientBridge.tsx', 'frontend/src/components/pda/PdaConnectionGate.tsx']
const shellSources = closure(shellRoots, edge => !edge.target.startsWith('frontend/src/pages/') && !edge.target.startsWith('frontend/src/router/routeRegistry'))

function classifySurface(component) {
  if (component === 'BaseCrudPage') return 'CRUD复合表面'
  if (component === 'PdaScanner') return '扫码输入'
  if (component === 'PdaNetworkBar') return '状态表面'
  if (/^(?:PdaLoading|PdaQueryError|AppToast)$/.test(component)) return '状态表面'
  if (/^(?:Dialog|AppDialog|ConfirmDialog|GlobalConfirmDialog|DirtyGuardDialog|AlertDialog|FinderModal|Sheet|Drawer|Popover|Select|DropdownMenu)$/.test(component)) return /Select$/.test(component) ? '选择器' : /DropdownMenu|Popover/.test(component) ? '浮层' : /Drawer|Sheet/.test(component) ? '抽屉' : '弹窗'
  if (/(?:Dialog|Modal|Overlay|Drawer|Sheet)$/.test(component)) return /Drawer|Sheet/.test(component) ? '抽屉' : '弹窗'
  if (/(?:Finder|Picker|Select|SelectField|PickerField)$/.test(component) || /^(?:DatePicker|WarehouseSelect|CategoryTreeSelect|OperatorSelectField|ShippingProductField|SettlementTypeField)$/.test(component)) return '选择器'
  if (/^(?:DataTable|ReportTable|VirtualTableBody|FinderTable)$/.test(component)) return '表格状态'
  if (/(?:State|ErrorBoundary|DoneView|Flash|Badge|Notice|RecoveryPanel|QueryFeedback|CriticalActionNotice|ConnectionGate|UpdateDialog)$/.test(component) || /^(?:OrderEntryIssues|RecoveryPanel|HandlingOperationPanel|DisposalExecutionPanel)$/.test(component)) return '状态表面'
  if (/^(?:GlobalSearch|NotificationBell|UserMenu|WorkspaceTabs|TopNav|DailyWork|MergedPage|KeepAliveOutlet|PdaHeader)$/.test(component)) return '导航/全局表面'
  return undefined
}
function enclosingNode(node) {
  let current = node
  while (current.parent && !ts.isSourceFile(current.parent)) {
    if (ts.isFunctionDeclaration(current.parent) || ts.isArrowFunction(current.parent) || ts.isFunctionExpression(current.parent)) return current.parent
    current = current.parent
  }
  return sourceOf(node)
}
function renderContainer(node) {
  let current = node
  for (let count = 0; current.parent && count < 6; count += 1) {
    if (ts.isJsxElement(current) && ['Dialog', 'AppDialog', 'Sheet', 'Drawer', 'Popover', 'Select', 'DropdownMenu'].includes(tagName(current.openingElement))) return current
    if (ts.isJsxElement(current.parent) || ts.isJsxExpression(current.parent) || ts.isJsxAttributes(current.parent)) current = current.parent
    else break
  }
  return ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent : node
}
function stateEvidence(node) {
  const found = Object.fromEntries(STATES.map(state => [state, []]))
  const seen = new Set()
  function add(state, evidenceNode, mechanism) {
    const location = where(evidenceNode)
    const key = `${state}:${location.source}:${location.line}:${mechanism}`
    if (seen.has(key)) return
    seen.add(key)
    found[state].push({ ...location, mechanism, excerpt: compact(evidenceNode.getText()) })
  }
  visit(node, child => {
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      const tag = tagName(child)
      const attrs = jsxAttrs(child)
      if ('disabled' in attrs || 'aria-disabled' in attrs) add('disabled', child, '实际 JSX disabled/aria-disabled 属性；须触发其条件验收')
      if ('loading' in attrs || 'isLoading' in attrs || 'isPending' in attrs) add('loading', child, '实际 JSX 加载/提交属性；须核实组件呈现')
      if (/^(QueryErrorState|PdaErrorState|ErrorBoundary|GlobalErrorBoundary|TabErrorBoundary|PdaErrorBoundary)$/.test(tag)) add('error', child, '实际错误表面组件调用')
      if (tag === 'PdaQueryError') add('error', child, '实际 PDA 查询错误表面调用')
      if (tag === 'PdaLoading') add('loading', child, '实际 PDA 加载表面调用')
      if (/^(EmptyState|PdaEmptyCard|PdaEmptyState)$/.test(tag)) {
        const state = attrs.variant === 'error' ? 'error' : attrs.variant === 'no-permission' ? 'denied' : 'empty'
        add(state, child, '实际空态/错误/权限预设调用；动态文案须运行时核实')
      }
      if (/^(PdaDoneView)$/.test(tag)) add('success', child, '实际完成表面组件调用')
      if (/UncertainSubmitNotice|PdaCriticalActionNotice|RecoveryPanel|HandlingOperationPanel|DisposalExecutionPanel/.test(tag)) add('unknown', child, '原请求结果待核对/恢复表面调用；具体状态须运行时核实')
      if (tag === 'PdaRoutePermission') add('denied', child, '实际 PDA 路由权限表面调用')
      for (const [key, value] of Object.entries(attrs)) {
        if (/^(status|state|tone|variant|type|phase)$/.test(key) && value === 'success') add('success', child, '实际 JSX 成功态属性')
        if (/^(status|state|phase)$/.test(key) && /unknown|uncertain|pending_result/.test(String(value))) add('unknown', child, '实际 JSX 待核对态属性线索')
      }
    }
    if (ts.isJsxText(child)) {
      const text = child.text.trim()
      if (/加载中|正在加载|正在读取|读取中|提交中|保存中|查询中/.test(text)) add('loading', child, '实际 JSX 加载/提交文案')
      if (/暂无|没有匹配|未找到|无可执行|无待处理|没有数据/.test(text)) add('empty', child, '实际 JSX 空结果文案')
      if (/加载失败|读取失败|请求失败|保存失败|查询失败|出现错误/.test(text)) add('error', child, '实际 JSX 失败文案')
      if (/无访问权限|没有权限|权限不足|权限未加载|无权/.test(text)) add('denied', child, '实际 JSX 权限文案')
      if (/结果待确认|结果不明|待核对|结果未知|不能确定/.test(text)) add('unknown', child, '实际 JSX 待核对文案')
    }
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const caller = child.expression.expression.getText()
      if (/toast|flash/i.test(caller) && ['error', 'success'].includes(child.expression.name.text)) add(child.expression.name.text, child, '实际反馈调用；不表示请求已在本次执行')
    }
    if (ts.isConditionalExpression(child) || ts.isIfStatement(child) || ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const condition = ts.isConditionalExpression(child) ? child.condition : ts.isIfStatement(child) ? child.expression : child.left
      const branches = ts.isConditionalExpression(child) ? [child.whenTrue, child.whenFalse] : ts.isIfStatement(child) ? [child.thenStatement, ...(child.elseStatement ? [child.elseStatement] : [])] : [child.right]
      if (!branches.some(branch => jsxTags(branch).length)) return
      const conditionText = condition.getText()
      if (/isLoading|isFetching|isPending|\bloading\b|\bpending\b|\bbusy\b/.test(conditionText)) add('loading', condition, '条件渲染加载/提交线索；分支实际效果待核实')
      if (/\blength\s*===?\s*0|!\w[\w.]*\.length/.test(conditionText)) add('empty', condition, '条件渲染空集合线索')
      if (/isError|\berror\b|\bfailed\b|\bloadError\b/.test(conditionText)) add('error', condition, '条件渲染失败线索')
      if (/\bcan[A-Z]\w*|!can\(|permissionsMissing|denied|forbidden/.test(conditionText)) add('denied', condition, '权限条件显隐线索；显隐不等同于独立拒绝态')
      if (/['"](?:unknown|uncertain|unresolved)['"]/.test(conditionText)) add('unknown', condition, '待核对条件渲染线索')
      if (/['"](?:success|done|completed|ok)['"]/.test(conditionText)) add('success', condition, '完成态条件渲染线索')
      if (/['"](?:error|err)['"]/.test(conditionText)) add('error', condition, '失败反馈条件渲染线索')
    }
  })
  return Object.fromEntries(STATES.map(state => [state, { status: found[state].length ? '有源码呈现线索；未运行验收' : '需运行时核实', evidence: found[state] }]))
}
const surfaces = []
const componentCalls = []
const componentDefinitions = new Map()
for (const info of bySource.values()) {
  if (!reachable.has(info.source)) continue
  const ordinals = new Map()
  function register(node, component, type, attrs, definition) {
    const ordinal = (ordinals.get(component) ?? 0) + 1
    ordinals.set(component, ordinal)
    const ownRoutes = routes.filter(route => routeReachability.get(route.id)?.has(info.source)).map(route => route.route)
    const callContainer = renderContainer(node)
    const definitionInfo = definition?.source && bySource.get(definition.source)
    const definitionStateRef = definitionInfo ? `definition:${definitionInfo.source}` : undefined
    if (definitionInfo && !componentDefinitions.has(definitionStateRef)) componentDefinitions.set(definitionStateRef, { id: definitionStateRef, source: definitionInfo.source, states: stateEvidence(definitionInfo.sf), evidenceBoundary: '组件文件级能力线索；可能包含多个导出，须分别核查具体 exportName 与调用条件' })
    const signature = crypto.createHash('sha256').update(node.getText().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12)
    surfaces.push({ id: `surface:${info.source}#${component}:${ordinal}:${signature}`, category: ownRoutes.length ? category(ownRoutes[0]) : info.source.includes('/pda/') || info.source.endsWith('PdaLayout.tsx') ? 'PDA' : '系统设置', categories: [...new Set(ownRoutes.map(category))], component, type, source: info.source, line: where(node).line, ownerFunction: ownerFunction(node), definition: definition ? { source: definition.source, exportName: definition.exportName } : undefined, purpose: attrs?.title ?? attrs?.label ?? attrs?.placeholder ?? attrs?.description ?? `${component} 当前实际调用表面`, openCondition: attrs?.open ?? attrs?.active ?? attrs?.visible ?? '由调用代码决定；需运行时触发', attributes: attrs, relatedRoutes: ownRoutes, globalShellCandidate: shellSources.has(info.source), reachability: '静态 import/组件调用可达，未证明条件分支实际渲染', states: stateEvidence(callContainer), definitionStateRef })
  }
  visit(info.sf, node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = tagName(node)
      const attributes = jsxAttrs(node)
      if (component === 'nav') { register(node, component, '导航/全局表面', attributes, undefined); return }
      if (/^(select|dialog|datalist)$/.test(component) || /^(input|Input)$/.test(component) && ['checkbox', 'radio', 'date', 'datetime-local', 'time', 'month', 'week', 'file', 'color'].includes(attributes.type)) {
        register(node, component, component === 'dialog' ? '弹窗' : '选择器', attributes, /^[A-Z]/.test(component) ? definitionFor(info, component) : undefined)
        if (!/^[A-Z]/.test(component)) return
      }
      if (!/^[A-Z]/.test(component)) return
      const definition = definitionFor(info, component)
      componentCalls.push({ ...where(node), component, ownerFunction: ownerFunction(node), definition, reachability: 'JSX 源码调用；未实际查看' })
      const type = classifySurface(component)
      if (type) register(node, component, type, jsxAttrs(node), definition)
    }
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText()
      const imported = ts.isIdentifier(node.expression) ? info.imports.get(node.expression.text) : undefined
      if (imported?.module === '@/lib/confirm' && imported.exportName === 'confirmAction' || /(?:\.showConfirm|window\.confirm)$/.test(name)) {
        const attrs = node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0]) ? literal(node.arguments[0]) : { description: node.arguments[0] ? literal(node.arguments[0]) : '无参数' }
        register(node, name, '命令式确认弹窗', attrs, imported?.module === '@/lib/confirm' ? { source: 'frontend/src/components/shared/GlobalConfirmDialog.tsx', exportName: 'GlobalConfirmDialog' } : undefined)
      }
    }
  })
}
const previous = fs.existsSync(outputFile) ? JSON.parse(fs.readFileSync(outputFile, 'utf8')) : undefined
const oldRecords = new Map([...(previous?.routes ?? []), ...(previous?.surfaces ?? [])].map(record => [record.id, record]))
const snapshotHash = crypto.createHash('sha256').update([...bySource.values()].map(info => `${info.source}\n${info.text}`).join('\n')).digest('hex')
function reviewFields(record) {
  const old = oldRecords.get(record.id)
  return {
    actualView: old?.actualView ?? '未查看',
    issues: old?.issues ?? [],
    modified: old?.modified ?? '未修改',
    verification: old?.verification ?? { sourceInventory: '已生成；不等同于代码审查或产品验证', componentTest: '未执行', gui: '未执行', rolePermission: '未执行', responsiveTheme: '未执行', devicePrint: '未执行' },
    uncoveredReason: old?.uncoveredReason ?? record.uncoveredReason ?? '仅建立源码入口地图；本清单任务未启动浏览器、后端、数据库、真机或打印环境',
    reviewSourceSnapshot: old?.reviewSourceSnapshot ?? null,
    manual: old?.manual ?? { purposeNote: '', classificationNote: '', acceptanceNotes: '' },
    evidence: old?.evidence ?? [],
    stateReview: old?.stateReview ?? Object.fromEntries(STATES.map(state => [state, { result: '未触发验收', evidence: [] }])),
    changeEvidence: old?.changeEvidence ?? [],
  }
}
for (const route of routes) {
  const info = bySource.get(route.source)
  route.states = info ? stateEvidence(info.sf) : Object.fromEntries(STATES.map(state => [state, { status: '需运行时核实', evidence: [] }]))
  route.subSurfaces = surfaces.filter(surface => surface.relatedRoutes.includes(route.route)).map(surface => surface.id)
  route.childPageCalls = componentCalls.filter(call => routeReachability.get(route.id)?.has(call.source) && call.definition?.source?.startsWith('frontend/src/pages/') && call.definition.source !== call.source).map(call => ({ source: call.source, line: call.line, component: call.component, target: call.definition.source }))
  if (route.kind === 'alias') route.uncoveredReason = '旧地址跳转须独立验证；目标页查看不代表旧地址已验收'
  Object.assign(route, reviewFields(route))
}
for (const surface of surfaces) Object.assign(surface, reviewFields(surface))
const statusComponents = [...new Set(surfaces.filter(surface => ['表格状态', '状态表面'].includes(surface.type)).map(surface => surface.definition?.source).filter(Boolean))].map(source => ({ source, calls: surfaces.filter(surface => surface.definition?.source === source).map(surface => surface.id), states: stateEvidence(bySource.get(source).sf), actualView: '未查看', verification: '未执行', note: '组件源码能力与每个业务用方必须分别验收' }))
const data = {
  schemaVersion: 1,
  auditDate: '2026-10-08',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceSnapshot: snapshotHash,
  generatedBy: 'scripts/design-audit/inventory.mjs',
  scope: '当前 frontend/src 可达 ERP/PDA/公开入口、工作区子视图、源码组件调用、弹窗/抽屉/选择器和状态表面',
  evidenceBoundary: '本文件包含静态覆盖地图与按具体路径/条件登记的审查证据。route、import、JSX、共享组件能力、截图捕获或测试文件存在均不能证明 GUI/业务/权限/真机/打印验收。所有新记录未查看、未执行；入口总览、人工细看、交互和状态验证分别记录，不能相互代替。',
  readAllowlist: ['frontend/src/**/*.{ts,tsx,js,jsx}（排除测试、生成代码、声明文件、assets）', '本目录 coverage.json（仅保留人工复核字段）', 'git rev-parse HEAD（版本元数据）'],
  sources: ['frontend/src/router/routeDefinitions.ts', 'frontend/src/router/routeRegistry.ts', 'frontend/src/router/index.tsx', 'frontend/src/router/pdaRoutes.tsx', 'frontend/src/router/mergedPageGroups.ts', 'frontend/src/components/shared/MergedPage.tsx', 'frontend/src/pages/warehouse-structure/index.tsx', 'frontend/src/pages/pda/index.tsx', 'frontend/src/components/shared/DailyWork.tsx', 'frontend/src/main.tsx'],
  summary: { routes: routes.length, canonicalRoutes: routes.filter(route => !['alias', 'fallback'].includes(route.kind)).length, aliases: routes.filter(route => route.kind === 'alias').length, fallbacks: routes.filter(route => route.kind === 'fallback').length, dynamicRoutes: routes.filter(route => route.kind === 'dynamic').length, newRoutes: routes.filter(route => route.kind === 'new' || route.route.endsWith('/new') || route.route === '/sale/new-kit').length, authenticationRoutes: routes.filter(route => route.kind === 'authentication').length, pdaRoutes: routes.filter(route => route.category === 'PDA').length, surfaces: surfaces.length, componentCalls: componentCalls.length, statusComponentDefinitions: statusComponents.length, parsedSourceFiles: bySource.size, reachableSourceFiles: reachable.size, excludedUnreachableSourceFiles: excludedFiles.length, actualViewed: routes.filter(route => route.evidence.some(item => item.humanViewed || item.overviewReviewed)).length, capturedRoutes: routes.filter(route => route.evidence.some(item => item.screenshots?.length)).length, overviewReviewedRoutes: routes.filter(route => route.evidence.some(item => item.overviewReviewed)).length, detailReviewedRoutes: routes.filter(route => route.evidence.some(item => item.humanViewed)).length, interactedRoutes: routes.filter(route => route.evidence.some(item => item.interaction)).length, reviewedSurfaces: surfaces.filter(surface => surface.evidence.some(item => item.humanViewed || item.interaction)).length, unreviewedSurfaces: surfaces.filter(surface => !surface.evidence.some(item => item.humanViewed || item.interaction)).length, groups: GROUPS.map(group => ({ group, routes: routes.filter(route => route.category === group).length, surfaces: surfaces.filter(surface => surface.category === group).length })), surfaceTypes: Object.fromEntries([...new Set(surfaces.map(surface => surface.type))].map(type => [type, surfaces.filter(surface => surface.type === type).length])) },
  evidenceIntegration: previous?.evidenceIntegration ?? { method: '尚未合入实际验收记录', sources: [], pending: [] },
  evidenceIndex: previous?.evidenceIndex ?? [],
  limitations: [
    'AST 枚举当前注册与源码可达性。静态 import 链可能包含条件分支、组件能力或页面对象；relatedRoutes 是待核查候选，不能当作可见/已验收证据。',
    '同组件多路径（退货、表单 new/detail、PDA list/:id、合并工作区）单列路由。仓库结构与 MergedPage 单列实际子页来源，其他业务分支仍须按参数/数据触发。',
    '运行过的具体路径、表面和状态以 evidence/stateReview 为准；无证据的权限角色、网络延迟/失败、离线、禁用/完成/结果未知分支继续待验。无呈现线索的状态保留需运行时核实，不能断言缺失。',
    'JSX 高阶动态对象渲染、render-prop、注册表函数返回、Portal 和原生 Electron/Android 弹窗可有运行时表面；import 边及全部大写组件调用供人工补查。命令式确认识别 lib/confirm、showConfirm、window.confirm。',
    'source/line 只引用当前源码。definitionStateRef 指向 componentDefinitions 的文件级能力线索，可能包含多个导出；不证明每个调用传入了对应条件，也不证明能力在具体用方出现。',
    '导航 hidden 指无顶栏/PDA ALL_OPS 注册。权限过滤、合并组去重、工作区子导航及条件来源按钮另有说明；不能推断普通员工一定可见。',
    '别名与根/未知路径回退是独立待验表面；直接查看目标页面不能替代跳转验证。',
    '未扫描后端、生产配置/.env、数据库数据、构建产物或 Android 原生工程；真实硬件扫码、打印、生产和发布证据不在本清单范围。',
    '未从当前入口或 import 链可达的源码列入 excludedSources，不能按文件名当作产品模块；新增入口后复跑将自动纳入。',
    '人工 actualView/issues/modified/verification/manual 字段按路由或调用签名 ID 保留；同类调用插入/顺序变化可能形成新 ID。reviewSourceSnapshot 须由验收者填写；生成脚本不自动宣布旧验收覆盖新源码。',
  ],
  routes,
  surfaces,
  componentDefinitions: [...componentDefinitions.values()],
  statusComponents,
  componentCalls,
  importEdges: [...bySource.values()].filter(info => reachable.has(info.source)).flatMap(info => info.importEdges),
  excludedSources: excludedFiles.map(source => ({ source, reason: '未从当前注册页面、全局壳层或 main/router 入口静态可达；未列为已实现产品表面' })),
}
function cell(value) { return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') }
function stateSummary(record) { return STATES.map(state => `${state}:${record.states[state].evidence.length ? '线索' : '待核'}`).join('；') }
function issueSummary(issues) {
  if (!issues.length) return '尚未审查'
  return issues.map(issue => typeof issue === 'string' ? issue : /^F\d{2}$/.test(issue.id ?? '') ? `${issue.id}/${issue.severity}` : `${issue.id ?? '发现'}：${String(issue.description ?? issue.result ?? issue.title ?? '具体结论见JSON').slice(0, 140)}`).join('；')
}
const md = [
  '# 2026-10-08 全系统设计审查覆盖地图',
  '',
  `源码提交：\`${data.sourceCommit}\`；扫描源码快照：\`${data.sourceSnapshot}\`（仅本脚本allowlist，不是整工作树/GUI截图版本指纹）。`,
  '',
  data.evidenceBoundary,
  '',
  `可复跑：\`node scripts/design-audit/inventory.mjs\`；只检查清单是否与当前源码相符：\`node scripts/design-audit/inventory.mjs --check\`。需要 frontend 的 TypeScript 开发依赖。脚本只读 allowlist 和自身输出，不加载应用，不读取敏感配置。`,
  '',
  '人工补充用途、分类、问题与验收结论请编辑 coverage.json 的 manual、actualView、issues、modified、verification、uncoveredReason、reviewSourceSnapshot 字段，再复跑以同步本文。不要编辑自动生成的 route/source/states/calls。验收结论应绑定实际源码快照及具体路径/条件。',
  '',
  '## 数量与来源',
  '',
  `路由 ${data.summary.routes} 条（实际入口 ${data.summary.canonicalRoutes}、兼容别名 ${data.summary.aliases}、未知地址回退 ${data.summary.fallbacks}；PDA ${data.summary.pdaRoutes}；动态 ${data.summary.dynamicRoutes}、新建 ${data.summary.newRoutes}、仅登录恢复 ${data.summary.authenticationRoutes}）。有人工查看证据 ${data.summary.actualViewed} 条，其中入口总览 ${data.summary.overviewReviewedRoutes}、代表状态细看 ${data.summary.detailReviewedRoutes}、实际交互 ${data.summary.interactedRoutes}（相互重叠，不能相加）。已捕获 ${data.summary.capturedRoutes} 条，捕获不等于人工细看。`,
  '',
  `弹窗、抽屉、选择器、浮层、状态/导航表面调用 ${data.summary.surfaces} 个；全部大写 JSX 组件调用 ${data.summary.componentCalls} 个；状态组件定义 ${data.summary.statusComponentDefinitions} 个。扫描源码 ${data.summary.parsedSourceFiles} 文件，可达 ${data.summary.reachableSourceFiles}，未从现入口可达 ${data.summary.excludedUnreachableSourceFiles}。共享组件与用方不会被换算成已验收。`,
  '',
  `具有指定条件人工查看/交互证据的调用点 ${data.summary.reviewedSurfaces} 个，仍无此证据 ${data.summary.unreviewedSurfaces} 个；即使已有一项证据，也不代表七种状态或全部 relatedRoutes 通过。`,
  '',
  '## 已合入证据与待验收',
  '',
  cell(data.evidenceIntegration.method),
  '',
  `coverage.json 的 evidenceIndex 收录 ${data.evidenceIndex.length} 条明确来源索引，保留观察路径、截图、阶段、人工查看/交互与调用记录关联。问题列的F01–F17对应 findings.md；映射仅表示源/调用影响范围，完整逐项结论及验证边界在JSON，不表示本页已经复现或全状态通过。`,
  '',
  ...(data.evidenceIntegration.sources ?? []).map(item => `- ${cell(typeof item === 'string' ? item : JSON.stringify(item))}`),
  '',
  '共享组件专项（不替代业务用方验收）：',
  '',
  ...(data.evidenceIntegration.sharedTests ?? []).map(item => `- ${cell(typeof item === 'string' ? item : JSON.stringify(item))}`),
  '',
  '明确待办（完整缺口仍在每条 route / surface 的 uncoveredReason 和 stateReview）：',
  '',
  ...(data.evidenceIntegration.pending ?? []).map(item => `- ${cell(typeof item === 'string' ? item : JSON.stringify(item))}`),
  '',
  '| 分类 | 路由 | 子表面调用候选 |',
  '| --- | ---: | ---: |',
  ...data.summary.groups.map(item => `| ${item.group} | ${item.routes} | ${item.surfaces} |`),
  '',
  '入口来源：',
  '',
  ...data.sources.map(source => `- \`${source}\``),
  '',
  '## 状态与证据口径',
  '',
  'loading / empty / error / denied / disabled / success / unknown 每项分别记录。线索表示实际 JSX 文案/属性、条件渲染、反馈调用或状态组件调用；仍须触发后查看。待核表示未提取到呈现线索，不表示没有实现。完整源码行号、条件与片段在 coverage.json 的 states；调用点自身与定义文件能力分开记录，definitionStateRef / componentDefinitions 不能替代用方验收。',
  '',
  '导航“隐藏”只指没有常驻顶栏或 PDA ALL_OPS 注册；动态表单、条件入口、工作区子视图仍可能通过实际操作到达。合并组权限过滤/顶栏去重单独登记。',
  '',
  ...GROUPS.flatMap(group => [
    `## ${group}`,
    '',
    '| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...routes.filter(route => route.category === group).map(route => `| \`${cell(route.route)}\` | ${cell(route.page)} / ${cell(route.manual.purposeNote || route.purpose)} | \`${cell(route.source)}\`；注册 ${cell(route.routeEvidence.source)}:${route.routeEvidence.line}${route.mergedWorkspace ? `；${cell(route.mergedWorkspace.title)} / ${cell(route.mergedWorkspace.view)}` : ''}${route.aliasTarget ? `；→ ${cell(route.aliasTarget)}` : ''} | ${route.navigation.hidden ? '隐藏；' : ''}${cell(route.navigation.mode)} | ${route.subSurfaces.length} | ${stateSummary(route)} | ${cell(route.actualView)} | ${cell(issueSummary(route.issues))} | ${cell(route.modified)} | ${cell(route.verification.gui)}；测试 ${cell(route.verification.componentTest)} | ${cell(route.uncoveredReason)} |`),
    '',
  ]),
  '## 弹窗、抽屉、选择器与状态表面实际调用点',
  '',
  '以下按源文件调用点列出；同一封装的不同调用点保留，底层 Dialog 与上层业务 Dialog 也分别保留。relatedRoutes 是 import 可达候选，不表示已渲染。完整相关路径、参数、definitionStateRef、问题/修改/验证字段见 JSON。categories 保存全部候选用方分类；表中分类取首个候选方便定位，跨模块共享调用不代表该单一分类专用。',
  '',
  '| 分类 | 表面 / 类型 | 实际调用点 | 用途 / 打开条件 | 候选用方 | 实际查看 / 验证 |',
  '| --- | --- | --- | --- | ---: | --- |',
  ...surfaces.map(surface => `| ${cell(surface.category)} | ${cell(surface.component)} / ${surface.type} | \`${cell(surface.source)}:${surface.line}\`${surface.definition ? ` → \`${cell(surface.definition.source)}\`` : ''} | ${cell(surface.manual.purposeNote || surface.purpose)}；${cell(surface.openCondition)} | ${surface.relatedRoutes.length}${surface.globalShellCandidate ? '；壳层候选' : ''} | ${cell(surface.actualView)} / ${cell(surface.verification.gui)} |`),
  '',
  '## 未覆盖与遗漏边界',
  '',
  ...data.limitations.map(item => `- ${item}`),
  '',
  '未从现入口可达的文件（不是本清单产品表面）：',
  '',
  ...data.excludedSources.map(item => `- \`${item.source}\` — ${item.reason}`),
  '',
].join('\n')
const json = serializeInventory(data)
const routeMap = JSON.stringify({ sourceCommit: data.sourceCommit, sourceSnapshot: data.sourceSnapshot, evidenceBoundary: data.evidenceBoundary, routes: routes.map(route => ({ route: route.route, path: route.kind === 'dynamic' ? null : route.route, pattern: route.routePattern ?? (route.route.includes(':id') ? route.route : null), kind: route.kind, aliases: routes.filter(alias => alias.aliasTarget === route.route).map(alias => alias.route), aliasTarget: route.aliasTarget ?? null, source: route.source, rendererSource: route.rendererSource, category: route.category, routeKey: route.mergedWorkspace?.key ?? route.aliasTarget ?? route.route, page: route.page, permission: route.permission, navigation: route.navigation, actualView: route.actualView, verification: route.verification.gui })) }, null, 2) + '\n'
if (process.argv.includes('--check')) {
  const mismatches = [[outputFile, json], [path.join(outDir, 'coverage.md'), md], [path.join(outDir, 'routes.json'), routeMap]].filter(([file, value]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== value).map(([file]) => relative(file))
  if (mismatches.length) { process.stderr.write(`Inventory stale: ${mismatches.join(', ')}\n`); process.exitCode = 1 }
} else {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputFile, json)
  fs.writeFileSync(path.join(outDir, 'coverage.md'), md)
  fs.writeFileSync(path.join(outDir, 'routes.json'), routeMap)
}
process.stdout.write(JSON.stringify(data.summary, null, 2) + '\n')
