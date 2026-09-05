/** PC UI 文件/路由/弹层静态清单。只读源码，不将扫描结果当作视觉验收。 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('../frontend/node_modules/typescript')
const root = path.resolve(__dirname, '..')
const sourceRoot = path.join(root, 'frontend/src')
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'pda') walk(file) }
    else if (file.endsWith('.tsx') && !file.includes('.test.') && entry.name !== 'PdaLayout.tsx') files.push(file)
  }
}
walk(sourceRoot)
const escape = value => value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const records = files.sort().map(file => {
  const code = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const surfaces = []
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast)
      if (/^(DialogContent|AppDialog|ConfirmDialog|BaseCrudPage|SheetContent|PopoverContent|Dialog\.Content|Popover\.Content)$/.test(tag)) {
        surfaces.push(`${tag}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (/createPortal\(/.test(code)) surfaces.push('createPortal（独立覆盖层）')
  return { file: path.relative(root, file), surfaces }
})
const registry = fs.readFileSync(path.join(sourceRoot, 'router/routeRegistry.ts'), 'utf8')
const ast = ts.createSourceFile('routeRegistry.ts', registry, ts.ScriptTarget.Latest, true)
const routes = []
function routesVisit(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const values = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(ast), p.initializer.getText(ast)]))
    if (values.has('component') && (values.has('path') || values.has('pattern'))) {
      routes.push([values.get('path') || values.get('pattern'), values.get('title') || '', values.get('component')])
    }
  }
  ts.forEachChild(node, routesVisit)
}
routesVisit(ast)
console.log('# PC UI 源码覆盖索引\n')
console.log('生成命令：`node scripts/pc-ui-inventory.cjs > docs/pc-ui-source-inventory.md`。\n')
console.log('范围：frontend/src 下非 PDA 专属的 TSX（排除测试和 PdaLayout），包含公共原语、无可视输出桥接器、登录与官网；这是候选文件清单，不是依赖可达性分析，也不代表每个数据状态已实页验收。界面实现与实页验证记录见 [收口报告](pc-ui-final-audit-2026-09-05.md)。\n')
console.log(`本次源码扫描：${records.length} 个候选 TSX 文件；${records.reduce((n, r) => n + r.surfaces.length, 0)} 个弹层/CRUD/覆盖层节点；路由注册表 ${routes.length} 个静态或动态定义。节点数量不等于独立弹窗数量，共用及条件实例可能重复。\n`)
console.log('## 注册路由\n\n| 路由或模式 | 标题 | 组件 |\n|---|---|---|')
for (const row of routes) console.log(`| ${row.map(escape).join(' | ')} |`)
console.log('\n## 文件与弹层入口\n\n未出现弹层节点的文件仍保留，避免漏掉全页表单、图表、原生覆盖层或公共组件。\n\n| 源文件 | 弹层、维护表单或覆盖层入口 |\n|---|---|')
for (const row of records) console.log(`| [${row.file.replace('frontend/src/', '')}](../${row.file}) | ${row.surfaces.join('；') || '—'} |`)
