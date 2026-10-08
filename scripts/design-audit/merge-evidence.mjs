#!/usr/bin/env node
/** Curated evidence merge. Reads only the named audit JSON/Markdown, and git path metadata.
 * Run inventory.mjs first, this script second, then inventory.mjs to render Markdown.
 * Source reachability never promotes all shared users to GUI acceptance.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { serializeInventory } from './serialize-inventory.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = path.join(root, 'docs/design-audit-2026-10-08')
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
const data = read('coverage.json')
const checkOnly = process.argv.includes('--check')
const stale = []
function writeOrCheck(name, contents) {
  const file = path.join(dir, name)
  if (!checkOnly) fs.writeFileSync(file, contents)
  else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) stale.push(name)
}
const routeMap = new Map(data.routes.map(route => [route.route, route]))
const states = ['loading', 'empty', 'error', 'denied', 'disabled', 'success', 'unknown']
// Replace only this merge's facts on rerun, preserving any later independent records.
for (const record of [...data.routes, ...data.surfaces]) {
  const old = record.evidence ?? []
  record.evidence = old.filter(item => !/^(root-before:|root-after:|root-final:|root-final-use:|root-axe-history:|root-fluid:|root-fluid-use:|root-fluid-scroll:|root-fluid-scroll-use:|a-before:|a-before-use:|a-after:|a-after-use:|a-followup:|a-followup-use:|a-overlays:|a-overlays-use:|a-final:|a-final-use:|b-pda-capture:|b-before-detail:|b-after:|b-after-use:|b-final:|b-reach:|b-allocation:|b-allocation-use:|b-reserve-read:|c-crud:|c-crud-use:|c-focus:|c-focus-use:|c-focus-extras:|c-focus-extras-use:|c-workspace-final:|c-workspace-final-use:|c-final-shared:|c-final-shared-use:|tabs-after-interaction)/.test(item.id))
  if (old.length && !record.evidence.length) {
    record.actualView = '未查看'
    record.verification.gui = '未执行'
    record.verification.visual = '未执行'
  }
}
function register(record, evidence) {
  const current = record.evidence ?? []
  record.evidence = [...current.filter(item => item.id !== evidence.id), evidence]
  record.manual.acceptanceNotes = '证据仅覆盖 evidence 中的具体阶段、路径、状态和交互；其余表面/用方/七态仍待验。'
}
function addRoute(route, evidence) {
  const record = routeMap.get(route)
  if (!record) throw new Error(`Evidence route absent from current inventory: ${route}`)
  register(record, evidence)
  if (evidence.overviewReviewed && !record.evidence.some(item => item.humanViewed)) record.actualView = '已查看入口布局总览；未等同于表单、子表面或全状态验收'
  if (evidence.humanViewed) record.actualView = '已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验'
  if (evidence.interaction) record.verification.gui = '已执行记录中的限定交互；未等同于业务提交或全页面验收'
  record.verification.visual = record.evidence.some(item => item.humanViewed) ? '代表截图已人工细看；不能代表全状态/全用方' : record.evidence.some(item => item.overviewReviewed) ? '入口总览已看；截图细节与交互待验' : '已捕获；人工细看待核实'
}

// Root manually reviewed all 12 contact sheets for the 108 requested paths.
// Their observation JSON still says capture; the explicit later declaration
// adds only layout-overview review, never individual state/interaction proof.
if (fs.existsSync(path.join(dir, 'observations-after.json'))) {
  const observations = read('observations-after.json')
  if (observations.length !== 108) throw new Error('Root overview count changed; inspect declaration before merging')
  for (const observation of observations) addRoute(actualPattern(observation.route), {
    id: `root-after:${observation.route}`, source: 'observations-after.json + root 声明逐张查看 contact-after-01–12', stage: 'after-overview', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, requestedRoute: observation.route, observedUrl: observation.url,
    viewport: observation.viewport, theme: observation.theme, screenshots: [observation.screenshot], overviewReviewed: true, humanViewed: false, interaction: false,
    result: '1440浅色布局缩略图概览；本批后续源码变化未由此图复验。未证明表单、empty/error、动态详情、权限、迟到响应或全状态通过。/login是已认证跳转，非登录表单。', concreteResourceRead: false,
  })
}
function addSurface(route, source, component, evidence, openCondition) {
  const matches = data.surfaces.filter(surface => surface.source === source && surface.component === component && (!evidence.specificCallId || surface.id === evidence.specificCallId) && (!openCondition || surface.openCondition === openCondition) && (surface.relatedRoutes.includes(route) || surface.globalShellCandidate))
  for (const surface of matches) {
    register(surface, { ...evidence, businessRoute: route, useBoundary: '仅此调用点在此业务路径/状态；其他 relatedRoutes 未自动验收' })
    surface.actualView = surface.evidence.some(item => item.humanViewed) ? '已人工查看指定业务路径的代表状态' : '已执行指定路径限定交互'
    surface.verification.gui = surface.evidence.some(item => item.interaction) ? '记录内限定交互已执行；其余状态/用方未执行' : '只观察；完整交互未执行'
    surface.verification.visual = surface.evidence.some(item => item.humanViewed) ? '指定样本人工细看；其他用方待验' : '未确认细看'
  }
}

// Root explicitly reviewed contact-before-01–08 for these 92 captures. GuestRoute
// redirected /login; that capture establishes a redirect, never the login form.
for (const observation of read('observations-before.json')) {
  const evidence = { id: `root-before:${observation.route}`, source: 'observations-before.json + root 人工查看 contact-before-01–08 的声明', stage: 'before', sourceCommit: '66fa87e', sourceSnapshot: null, requestedRoute: observation.route, observedUrl: observation.url, viewport: observation.viewport, theme: observation.theme, screenshots: [observation.screenshot], overviewReviewed: true, humanViewed: false, interaction: false, result: '入口总览已查看；自动 DOM/overflow 测量仅为捕获，不证明行为或七态通过' }
  addRoute(observation.route, evidence)
  if (observation.route === '/login') {
    routeMap.get('/login').actualView = '已查看认证跳转；登录表单未查看'
    routeMap.get('/login').uncoveredReason = '已认证 GuestRoute 跳转到 dashboard；需要未登录会话单独验收登录表单/错误/键盘'
  }
}

// Assessment A explicitly states all 20 before screenshots were viewed.
const aBefore = [
  ['/sale', ['a-sale', 'a-sale-query'], '列表和查询；无业务提交'],
  ['/purchase', ['a-purchase'], '正常数据列表；错误和迟到请求未在before触发'],
  ['/refunds', ['a-refunds', 'a-refunds-error-empty', 'a-refunds-create'], 'API500被画成空结果；创建表单只打开，未提交'],
  ['/supplier-refunds', ['a-supplier-refunds'], '列表入口与分页/身份层级'],
  ['/supplier-refunds/new', ['a-supplier-refunds-create'], '来源读取失败、表单禁用；不能代表完整分配数据'],
  ['/finance/dashboard', ['a-finance-dashboard'], '资金看板代表状态'],
  ['/finance/accounts', ['a-finance-accounts', 'a-finance-account-create'], '资金账户及创建控件名称；未提交'],
  ['/finance/transactions', ['a-finance-transactions'], '读取正常的空列表'],
  ['/customers', ['a-customers', 'a-customer-create'], '客户列表和创建；只观察后取消'],
  ['/suppliers', ['a-suppliers', 'a-supplier-create'], '供应商列表和创建；只观察后取消'],
  ['/settings', ['a-settings', 'a-settings-edit'], '设置查看/进入编辑/取消；未保存'],
  ['/returns/purchase', ['a-purchase-returns'], '合成采购退货草稿列表'],
  ['/returns/sale', ['a-sale-returns'], '正常空结果'],
]
for (const [route, images, result] of aBefore) addRoute(route, { id: `a-before:${route}`, source: 'assessment-a.md:149–170', stage: 'before', sourceCommit: '66fa87e', sourceSnapshot: null, viewport: '1440x900', theme: 'light', screenshots: images.map(image => `screens/before/${image}.png`), humanViewed: true, interaction: images.some(image => /query|create|edit/.test(image)), result })
const aSurfaces = [
  ['/sale', 'frontend/src/pages/sale/index.tsx', 'SaleQueryDialog'],
  ['/customers', 'frontend/src/pages/customers/index.tsx', 'CustomerFormDialog'],
  ['/suppliers', 'frontend/src/pages/suppliers/index.tsx', 'BaseCrudPage'],
  ['/finance/accounts', 'frontend/src/pages/finance/accounts/index.tsx', 'Dialog', 'formOpen'],
  ['/refunds', 'frontend/src/pages/refunds/index.tsx', 'CreateRefundDialog'],
]
for (const [route, source, component, openCondition] of aSurfaces) addSurface(route, source, component, { id: `a-before-use:${route}:${component}`, source: 'assessment-a.md', stage: 'before', sourceCommit: '66fa87e', sourceSnapshot: null, humanViewed: true, interaction: true, result: '仅打开/观察/取消；未提交，未逐字段/七态验收' }, openCondition)
const refunds = routeMap.get('/refunds')
refunds.stateReview.error = { result: 'before实测失败：500被画成暂无数据/共0；after由A继续验收', evidence: ['assessment-a.md:A1', 'screens/before/a-refunds-error-empty.png'] }
refunds.issues = [...refunds.issues.filter(issue => issue.id !== 'A1'), { id: 'A1', severity: 'P1', result: 'before实际复现；after验收证据尚需追加', description: '读取500被画成空结果/共0；后端错误与UI缺少错误呈现分别核对' }]
for (const route of ['/finance/transactions', '/returns/sale']) routeMap.get(route).stateReview.empty = { result: 'before人工查看正常读取的空结果；完整错误/重试未覆盖', evidence: ['assessment-a.md:159–162'] }
routeMap.get('/supplier-refunds/new').stateReview.disabled = { result: 'before来源读失败后的禁用表面已查看；完整可分配来源待验', evidence: ['assessment-a.md:158'] }

// B distinguishes automatic navigation/capture from the few manually inspected images.
for (const observation of read('observations-pda-before.json').routes) {
  const route = observation.url.replace(/^#/, '').replace(/\/$/, '') || '/pda'
  addRoute(route, { id: `b-pda-capture:${route}`, source: 'observations-pda-before.json + Assessment B 实际范围补充', stage: 'before', sourceCommit: '66fa87e', sourceSnapshot: null, observedUrl: observation.url, viewport: ['390x844', '320x844'], theme: 'light', screenshots: [observation.screenshot390, observation.screenshot320], humanViewed: false, interaction: false, result: route === '/pda/split-recovery' ? '一次HMR触发绑定门，不能作为恢复页内容验收；待重新捕获' : '实际导航/DOM/overflow读取和截图；未声明逐图人工细看，不是动态任务/原生扫码验收' })
}
const bSamples = [
  ['/inventory', ['b-query-1024'], '查询打开/取消；1024代表状态'],
  ['/settings', ['b-settings-edit-1024'], '设置进入编辑后取消；未改值/保存'],
  ['/pda/bind', ['b-pda-bind-manual-390', 'b-pda-bind-manual-320', 'b-pda-bind-dark-simulated-320', 'b-pda-scanner-manual-320', 'b-pda-scanner-filled-320'], '未绑定设备页：真实Enter未展开/Space展开；手动扫码显式开启、焦点、输入合成文本后取消，未提交；手动区和模拟dark已细看；after未复验'],
  ['/sale/new', ['b-product-finder-1024'], '从添加商品打开Finder，1024完整宽表/横向滚动/取消代表状态已细看；未选商品/保存'],
]
for (const [route, images, result] of bSamples) addRoute(route, { id: `b-before-detail:${route}`, source: 'assessment-b.md + B 本次人工查看范围声明', stage: 'before', sourceCommit: '66fa87e', sourceSnapshot: null, screenshots: images.map(image => `screens/before/${image}.png`), humanViewed: true, interaction: true, result })
addRoute('/pda/receive/:id', { id: 'b-before-detail:receive2', source: 'Assessment B 实际任务2范围声明', stage: 'before', sourceCommit: '66fa87e', sourceSnapshot: null, observedUrl: '#/pda/receive/2', screenshots: ['screens/before/b-pda-receive-2-320.png', 'screens/before/b-pda-receive-2-390.png'], humanViewed: true, interaction: false, result: '合成收货任务2真实读取，320截图人工细看；未执行收货/撤回/超收/打印' })

const tabEvidence = { id: 'tabs-after-interaction', source: 'workspace-tabs-validation.md', stage: 'after', sourceCommit: '66fa87e + 工作树变更', sourceSnapshot: null, screenshots: ['workspace-tabs-after.png', 'workspace-tabs-draft-cancel.png'], humanViewed: true, interaction: true, result: '同商品页三tab样本axe0/0；方向/Home/End/Enter/Space、菜单Escape回焦、草稿Delete取消保留及切回、确认回列表、非活动关闭Enter；未保存业务单据', componentTests: 'WorkspaceTabs.keyboard + store/title/KeepAlive: 23/23', codeBinding: '报告记录当时组件；当前其他工作树改动应统一复验' }
addSurface('/products', 'frontend/src/layouts/AppLayout.tsx', 'WorkspaceTabs', tabEvidence)
for (const route of ['/products', '/sale', '/sale/new']) addRoute(route, { ...tabEvidence, id: `${tabEvidence.id}:${route}`, result: `${tabEvidence.result}；只验证工作区标签，不能代表本页其他子表面通过` })

if (fs.existsSync(path.join(dir, 'a-after.md'))) {
  const report = fs.readFileSync(path.join(dir, 'a-after.md'), 'utf8')
  if (!/46.*张/.test(report) || !/56.*用例通过/.test(report) || !/21.*张/.test(report)) throw new Error('A after evidence changed; review curated merge first')
  // Fixed reviewed index. A new file appearing while another agent works is not
  // automatically a reviewed image; append only after its report is read.
  const screenshots = [
    'a-finance-account-labels',
    'a-refunds-error', 'a-refunds-create-labels', 'a-refunds-error-light', 'a-refunds-error-dark', 'a-refunds-retry-still-error-light', 'a-refunds-retry-still-error-dark',
    ...['customers', 'transactions', 'vouchers', 'payable', 'receivable', 'purchase'].flatMap(page => [`a-${page}-normal`, ...['error', 'retry'].flatMap(state => ['light', 'dark'].map(theme => `a-${page}-${state}-${theme}`))]),
    'a-purchase-returns-normal',
    ...['purchase', 'sale'].flatMap(type => ['error', 'retry'].flatMap(state => ['light', 'dark'].map(theme => `a-returns-${type}-${state}-${theme}`))),
  ].map(name => `${name}.png`)
  if (screenshots.length !== 46 || screenshots.some(name => !fs.existsSync(path.join(dir, 'screens/after', name)))) throw new Error('A original reviewed screenshot index changed')
  const aAfter = [
    ['/refunds', /^a-refunds-/, '捕获当时真实API500持续错误，无空数据/共0；同参数真实重试仍500；新建各字段名称已读，只打开/取消。后来后端AND AND缺陷独立真实库9例通过，重载后的成功列表/详情GUI仍待另补证'],
    ['/finance/accounts', /^a-finance-account-labels/, '资金账户新建字段名称、打开和取消；未改余额或提交'],
    ['/customers', /^a-customers-/, '正常1条→保留关键词中断→持续错误且隐藏旧行/计数→真实重试恢复1条'],
    ['/finance/transactions', /^a-transactions-/, '正常1笔→保留关键词/发生日期中断→隐藏旧流水和三项汇总→真实重试恢复1笔/支出4.00'],
    ['/accounting/vouchers', /^a-vouchers-/, '真实空列表→保留关键词中断列表→隐藏空表/零数，独立成功勾稽保留→真实重试0张；未生成凭证'],
    ['/payments/payable', /^a-payable-/, '现结供应商账款正常空→保留单号/未结清筛选中断→持续错误→真实重试0笔；未登记'],
    ['/payments/receivable', /^a-receivable-/, '现结客户账款正常空→保留单号筛选中断→持续错误→真实重试0笔；未登记'],
    ['/purchase', /^a-purchase-(?!returns)/, '正常1单→保留单号中断→旧单和计数隐藏→真实重试1单'],
    ['/returns/purchase', /^a-(?:purchase-returns|returns-purchase)-/, '正常1单→保留单号中断→旧单和计数隐藏→真实重试1单'],
    ['/returns/sale', /^a-returns-sale-/, '保留单号中断→持续错误→真实重试真实空0单'],
  ]
  const listErrorOwners = {
    '/refunds': ['frontend/src/pages/refunds/index.tsx', 'RefundsPage'],
    '/customers': ['frontend/src/pages/customers/index.tsx', 'CustomersPage'],
    '/finance/transactions': ['frontend/src/pages/finance/transactions/index.tsx', 'FinanceTransactionsPage'],
    '/accounting/vouchers': ['frontend/src/pages/accounting/vouchers/index.tsx', 'VouchersPage'],
    '/payments/payable': ['frontend/src/pages/payments/PaymentsView.tsx', 'PaymentsView'],
    '/payments/receivable': ['frontend/src/pages/payments/PaymentsView.tsx', 'PaymentsView'],
    '/purchase': ['frontend/src/pages/purchase/index.tsx', 'PurchasePage'],
    '/returns/purchase': ['frontend/src/pages/returns/index.tsx', 'ReturnsPage'],
    '/returns/sale': ['frontend/src/pages/returns/index.tsx', 'ReturnsPage'],
  }
  for (const [route, pattern, result] of aAfter) {
    const record = routeMap.get(route)
    const evidence = { id: `a-after:${route}`, source: 'a-after.md:3 + a-tests-green-final.log', stage: 'after', sourceCommit: '66fa87e + 工作树变更', sourceSnapshot: null, viewport: '1440x900', theme: 'light + DOM模拟dark（非主题切换功能）', screenshots: screenshots.filter(name => pattern.test(name)).map(name => `screens/after/${name}`), humanViewed: true, interaction: true, result, componentTests: '11文件56例；按该实际组件/用例分别覆盖，API边界夹具；不是GUI权限/详情验证', codeBinding: '46张原GUI先于A最后ink/账款nav/采购create权限追加；对应源码测试已56例，统一重载后的GUI另补证' }
    addRoute(route, evidence)
    record.verification.componentTest = 'A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2'
    record.verification.responsiveTheme = 'A在1440x900浅色及DOM模拟dark细看；非主题切换功能；窄屏/原生端未验证'
    if (route !== '/finance/accounts') {
      record.stateReview.error = { result: 'after实际中断/持续错误/筛选保持/真实重试已查看；退款真实500重试仍错误；具体路径见证据', evidence: ['a-after.md:3', evidence.id] }
      // Same-named error variables in local detail/reconciliation functions are
      // separate calls. Only the actual page function's list error was observed.
      const [source, owner] = listErrorOwners[route]
      const matches = data.surfaces.filter(surface => surface.source === source && surface.ownerFunction === owner && surface.component === 'QueryErrorState' && surface.attributes.error === 'error')
      if (matches.length !== 1) throw new Error(`A list error call changed; inspect ${route}: ${matches.length}`)
      const surface = matches[0]
      addSurface(route, surface.source, surface.component, { ...evidence, id: `a-after-use:${route}:${surface.id}`, specificCallId: surface.id, result: '该列表错误调用点实际持续显示并重试；详情/勾稽/追踪局部函数同名error变量不自动验收' }, surface.openCondition)
      surface.stateReview.error = { result: '该调用点在指定业务路径实际触发持续错误并真实重试；其他 relatedRoutes/状态待验', evidence: [evidence.id] }
    }
    if (['/accounting/vouchers', '/payments/payable', '/payments/receivable', '/returns/sale'].includes(route)) record.stateReview.empty = { result: 'after真实重试到成功空结果；失败与空结果有区别；未执行业务写入', evidence: ['a-after.md:3', evidence.id] }
  }
  refunds.issues = refunds.issues.map(issue => issue.id === 'A1' ? { ...issue, result: '前端持续失败呈现及后端AND AND机械缺陷已分别复验；原500历史截图保留；最终GUI正常/筛选真实空→abort→重试通过，无客户退款记录所以正向详情/出账仍未验' } : issue)

  const followup = [
    ['/refunds', ['a-refunds-sql-normal-light', ...['filter', 'error', 'retry'].flatMap(state => ['light', 'dark'].map(theme => `a-refunds-sql-${state}-${theme}`))], '最终源码API正常/组合筛选真实200空；RF-retry-keep仅中断本列表→持续错误隐藏空/零数→撤销拦截真实重试空，关键词保留；无客户退款记录，未验正向详情/出账'],
    ...['receivable', 'payable'].map(type => [`/payments/${type}`, [`a-${type}-nav-records-light`, `a-${type}-nav-receipts-light`, ...['light', 'dark'].map(theme => `a-${type}-nav-retained-${theme}`)], '现结按单→核销，具名nav唯一当前值；查询后切走/回核销保留筛选；真实空集合；未登记/核销/创建']),
    ['/finance/transactions', ['a-transactions-ink-light', 'a-transactions-ink-dark'], '真实1笔合成支出4.00与收入/支出/净额文字ink浅深细看；未登记'],
    ['/accounting/vouchers', ['a-vouchers-ink-light', 'a-vouchers-ink-dark'], '真实空列表与真实独立勾稽差额警告浅深ink细看；未生成，不把差额称正常入账'],
    ['/finance/accounts', ['a-accounts-transactions-ink-light', 'a-accounts-transactions-ink-dark'], '只打开合成付款账户流水弹窗，收入0/支出4.00/余额9996.00浅深细看后关闭；未修改账户'],
  ]
  if (followup.flatMap(([, names]) => names).length !== 21) throw new Error('A followup reviewed index count changed')
  for (const [route, names, result] of followup) {
    const evidence = { id: `a-followup:${route}`, source: 'a-after.md:7 + a-gui-followup.md + a-api-read-green.json', stage: 'after-final-source', sourceCommit: '66fa87e + 工作树变更', sourceSnapshot: null, viewport: '1440x900', theme: 'light + DOM模拟dark（非主题切换功能）', screenshots: names.map(name => `screens/after/${name}.png`), humanViewed: true, interaction: ['/refunds', '/payments/receivable', '/payments/payable', '/finance/accounts'].includes(route), result }
    if (evidence.screenshots.some(name => !fs.existsSync(path.join(dir, name)))) throw new Error(`A followup image absent: ${route}`)
    addRoute(route, evidence)
    if (route === '/refunds') {
      refunds.stateReview.error = { result: '最终GUI真实中断后持续错误/筛选保持，再真实重试成功空；历史500并未改写为成功', evidence: [evidence.id] }
      refunds.stateReview.empty = { result: '最终源码真实API200空结果与失败已区分，默认/组合筛选/真实重试空均细看；无正向详情/出账', evidence: [evidence.id] }
      const surface = data.surfaces.find(s => s.source === refunds.source && s.component === 'QueryErrorState' && s.ownerFunction === 'RefundsPage')
      addSurface(route, surface.source, surface.component, { ...evidence, id: `a-followup-use:${surface.id}`, specificCallId: surface.id })
    }
    if (route.startsWith('/payments/')) addSurface(route, 'frontend/src/pages/payments/PaymentsView.tsx', 'nav', { ...evidence, id: `a-followup-use:${route}:nav`, result: '仅活动现结登记方式nav的具名/唯一aria-current与切换保留；月结/其他隐藏nav未自动验收' })
    if (route === '/finance/accounts') addSurface(route, routeMap.get(route).source, 'Dialog', { ...evidence, id: 'a-followup-use:accounts-transactions' }, '!!txAccount')
  }
}

function actualPattern(url) {
  const route = url.replace(/^#/, '').replace(/\/$/, '') || '/pda'
  if (routeMap.has(route)) return route
  const matches = data.routes.filter(item => item.kind === 'dynamic' && new RegExp(`^${item.route.replace(/:[^/]+/g, '[^/]+')}$`).test(route))
  if (matches.length !== 1) throw new Error(`Concrete evidence path unmatched: ${route}`)
  return matches[0].route
}
if (fs.existsSync(path.join(dir, 'a-followup-screens.json'))) {
  const manifest = read('a-followup-screens.json')
  if (manifest.images.length !== 41 || manifest.images.some(image => image.imageReviewed !== true || !fs.existsSync(path.join(root, image.path)))) throw new Error('A overlays reviewed manifest changed; inspect its declaration')
  const index = new Map(manifest.images.map(image => [path.basename(image.path, '.png'), image.path.replace('docs/design-audit-2026-10-08/', '')]))
  const samples = [
    ['/customers', ['a-followup-customer-edit-1024-light', 'a-followup-customer-edit-1024-dark', 'a-fixed-customer-discard-1024-dark', 'a-fixed-customer-discard-1024-light', 'a-fixed-customer-resume-1024-dark', 'a-fixed-customer-selector-resume-1024-light'], '备注及仅现结selector变化Escape→继续保留并回焦原字段→放弃；服务端月结30天未改；浅深，未保存', 'CustomerFormDialog'],
    ['/users', ['a-followup-user-edit-1024-light', 'a-fixed-user-discard-1024-light', 'a-fixed-user-resume-1024-dark'], '姓名输入→Escape→继续保留并回焦→放弃；非超级管理员账号按原规则只读；未保存', 'UserFormDialog'],
    ['/accounting/invoices', ['a-followup-invoice-create-1024-light', 'a-followup-invoice-create-1024-dark', 'a-fixed-invoice-labels-1024-light', 'a-fixed-invoice-resume-1024-dark'], '9字段真实名称；代码输入Escape→继续保留回焦→放弃；浅深。最新日期未blur保护/日历Escape和读取错误尚未由这些图复验', 'InvoiceDialog'],
    ['/approvals/flows', ['a-followup-approval-flow-create-1024-light', 'a-fixed-approval-labels-1024-light', 'a-fixed-approval-resume-1024-dark'], '真实空列表打开新增；字段名称/流程名输入Escape→继续保留回焦→放弃；无既有流程可编辑、未保存审批', 'Dialog', 'formOpen'],
    ['/approvals/pending', ['a-followup-approvals-pending-1024-light'], '真实没有待审批单据；无详情或实际审批', null],
    ['/settings/pda-devices', ['a-followup-pda-device-edit-1024-light', 'a-followup-pda-device-edit-1024-dark', 'a-fixed-pda-edit-labels-1024-light', 'a-fixed-pda-edit-labels-1024-dark', 'a-fixed-pda-create-labels-1024-light', 'a-fixed-pda-create-labels-1024-dark'], '合成既有设备编辑和新登记真实名称/仓库名称浅深；未改值，干净Escape关闭回原编辑按钮；没有登记/改绑/保存', 'Dialog', ['createOpen', '!!editing']],
    ['/finance/transactions', ['a-followup-transactions-query-1024-light', 'a-fixed-transactions-query-labels-1024-light', 'a-fixed-transactions-query-labels-1024-dark'], '实际查询6字段名称浅深并取消；未资金登记', 'TransactionsQueryDialog'],
    ['/finance/accounts', ['a-followup-account-flow-1024-light', 'a-followup-account-flow-1024-dark'], '实际4元普通支出流水/PC20261008001/2026-10-08/余额9996浅深Escape关闭；该记录没有详情入口，未虚构详情或出账', 'Dialog', '!!txAccount'],
    ['/payments/ledger/customer/:id', ['a-followup-customer-ledger-1024-light'], '从客户行往来明细实际打开/payments/ledger/customer/1独立工作区，当前期间空态/0，非详情弹窗；当时网络未留存，未升级GET实证', null],
    ['/accounting/vouchers', ['a-followup-vouchers-query-1024-light', 'a-followup-vouchers-query-1024-dark', 'a-followup-vouchers-empty-1024-light'], '查询实际打开/应用关键词后真实空；勾稽资金差额-4/应付-296.29/应收匹配；未会计写入，不称财务一致', 'VoucherQueryDialog'],
    ['/permissions', ['a-followup-role-permissions-edit-1024-light'], '内联编辑打开随后取消；角色局部切换未取得明确脏保护/回焦证据', null],
    ['/settings', ['a-followup-settings-edit-1024-light'], '内联编辑打开随后取消；未上传/保存/外部调用', null],
    ['/settings/printers', ['a-followup-printer-table-1024-light', 'a-followup-printer-binding-1024-light', 'a-followup-printer-binding-1024-dark'], '1024水平滚动到绑定操作→合成OWN打印机绑定浮层浅深Escape关闭；7个点击即写按钮均未点；未绑定或打印', 'Dialog', 'true'],
    ['/settings/print-templates', ['a-followup-print-templates-error-1024-light'], '真实GET400标签格式错误；当时旧UI仍画暂无数据。最新错误/重试UI另待GUI，既有模板编辑受阻', null],
    ['/settings/print-templates/new', ['a-followup-template-editor-1024-light'], '新建编辑器默认画布/合成销售预览，未保存或打印；不能替代非法既有模板详情', null],
    ['/logistics', ['a-followup-logistics-query-1024-light', 'a-followup-logistics-query-1024-dark'], '真实空页查询关键字/状态/承运商名称浅深Escape关闭；最新共享日期名称/Escape尚未由此图复验', 'WaybillQueryDialog'],
  ]
  const consumed = samples.flatMap(([, names]) => names)
  if (consumed.length !== 41 || new Set(consumed).size !== 41 || consumed.some(name => !index.has(name))) throw new Error('A overlays exact business mapping does not cover its 41 images')
  for (const [route, names, result, component, openCondition] of samples) {
    const evidence = { id: `a-overlays:${route}`, source: 'a-followup-overlays.md + a-followup-screens.json（A声明逐张细看）', stage: 'after-overlay-followup', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, viewport: '1024x768', theme: 'light + DOM模拟dark（非产品切换）', screenshots: names.map(name => index.get(name)), humanViewed: true, interaction: !['/approvals/pending', '/payments/ledger/customer/:id', '/settings/print-templates'].includes(route), result, businessWrite: false, concreteResourceRead: route !== '/payments/ledger/customer/:id', codeBinding: '标签/草稿当时版本；最新日期、公共AppDialog与两个list错误改动需要后续fresh证据，不能由旧图自动升级', componentTests: '本追加5文件42例/11路径lint0/完整tsc0；与旧67图/56例分开，非全GUI/全量业务验证' }
    addRoute(route, evidence)
    if (route === '/payments/ledger/customer/:id') evidence.observedUrl = '#/payments/ledger/customer/1'
    if (component) for (const condition of Array.isArray(openCondition) ? openCondition : [openCondition]) addSurface(route, routeMap.get(route).source, component, { ...evidence, id: `a-overlays-use:${route}:${component}:${condition ?? 'component-call'}` }, condition)
    if (route === '/settings/print-templates') {
      routeMap.get(route).stateReview.error = { result: 'A现场真实GET400而旧UI误画空；源码错误/重试已补，最新GUI另待，未放宽模板格式拒绝', evidence: [evidence.id] }
      routeMap.get(route).issues = [...routeMap.get(route).issues.filter(issue => issue.id !== 'A-template-read'), { id: 'A-template-read', severity: 'P1', description: '读取400被旧UI画成空结果；非法模板详情受阻', result: '组件首载/缓存错误red→green，现场最新错误/真实重试仍待补验' }]
    }
  }
}
if (fs.existsSync(path.join(dir, 'observations-pda-after.json'))) {
  const b = read('observations-pda-after.json')
  for (const observation of b.routes) {
    const route = actualPattern(observation.url)
    addRoute(route, { id: `b-after:${observation.url}`, source: 'observations-pda-after.json + implementation-b.md', stage: 'after', sourceCommit: '66fa87e + 当时工作树变更', sourceSnapshot: null,
      observedUrl: observation.url, viewport: observation.viewport, theme: 'light', screenshots: [observation.screenshot], humanViewed: observation.visualReviewed === true, interaction: false,
      result: observation.reviewScope, codeBinding: '后续main/公共ink/理由min44变化未由初批图证明；final bind及指定追加图另列。', componentTests: 'B最终30文件193例与tsc；仅对应组件/夹具，不代表业务提交/原生硬件',
    })
    if (['/pda/picking', '/pda/split-recovery'].includes(route)) routeMap.get(route).stateReview.empty = { result: '真实成功空态已细看；B口述my-tasks500诊断已纠正，不保留为页面失败事实', evidence: [`b-after:${observation.url}`] }
  }
  for (const [index, observation] of b.laterReviewedStates.entries()) {
    const evidence = { id: `b-after:later:${index}`, source: 'observations-pda-after.json:laterReviewedStates + implementation-b.md', stage: 'after-interaction', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null,
      observedUrl: observation.route ? `#${observation.route}` : null, viewport: observation.viewport, theme: observation.state.includes('dark') ? 'DOM模拟dark（非产品切换）' : 'light', screenshots: [observation.screenshot], humanViewed: observation.visualReviewed === true, interaction: true,
      result: `${observation.state}；${observation.interaction}；${observation.boundary ?? observation.lastSourceChangeAfterCapture ?? '无业务提交/原生硬件证据'}`,
    }
    if (observation.route) addRoute(actualPattern(observation.route), evidence)
    else if (observation.component === 'PdaOverReceiveDialog') {
      for (const surface of data.surfaces.filter(item => item.component === 'PdaOverReceiveDialog')) register(surface, { ...evidence, actualBusinessRouteAcceptance: false, useBoundary: '仅真实组件合成props临时预览；不得提升各调用页面业务触发验收' })
    }
  }
  for (const [pathTail, reason] of Object.entries(b.dynamicDetailCoverage)) {
    const route = `/pda/${pathTail}`
    if (routeMap.has(route)) routeMap.get(route).manual.dynamicBoundary = reason
  }
}
if (fs.existsSync(path.join(dir, 'observations-pda-final.json'))) {
  const final = read('observations-pda-final.json')
  for (const observation of final.routes) {
    const route = actualPattern(observation.url), evidence = {
      id: `b-final:${observation.url}:${observation.viewport[0]}`, source: 'observations-pda-final.json + implementation-b.md:final', stage: 'after-final-source', sourceCommit: '66fa87e + 当前工作树', sourceSnapshot: null,
      observedUrl: observation.url, viewport: observation.viewport, theme: 'light', screenshots: [observation.screenshot], humanViewed: observation.visualReviewed === true, interaction: false,
      result: `${observation.reviewScope}；${observation.limit ?? '无业务提交'}`, concreteResourceRead: !route.startsWith('/pda/ship/'),
    }
    addRoute(route, evidence)
    if (/\/pda\/(check|pack)\//.test(route)) routeMap.get(route).stateReview.denied = { result: '真实资源阶段不允许进入执行态；页面说明已细看。不是权限撤销、待复核/待打包或可提交阶段通过', evidence: [evidence.id] }
    if (route.startsWith('/pda/putaway/')) routeMap.get(route).stateReview.success = { result: 'inbound1已完成说明态和inbound2尚未收货说明态真实读取/细看；无待上架执行fixture', evidence: ['observations-pda-final.json'] }
  }
  addRoute('/pda/bind', { id: 'b-final:bind-axe', source: 'observations-pda-final.json:finalBoundAxe + coverage_inventory实际细看该final图', stage: 'after-final-source', sourceCommit: '66fa87e + 当前工作树', sourceSnapshot: null,
    observedUrl: '#/pda/bind', viewport: final.finalBoundAxe.viewport, theme: 'light', screenshots: [final.finalBoundAxe.screenshot], humanViewed: true, interaction: false,
    result: '合法绑定/展开手动区空凭据；本审查者细看final图main与有效badge样本可读；B同状态axe35pass/0violations/0incomplete。未解绑或重新提交此状态。',
    accessibility: final.finalBoundAxe,
  })
}
if (fs.existsSync(path.join(dir, 'evidence-b/pda-320-reachability.json'))) {
  const observation = read('evidence-b/pda-320-reachability.json')
  addRoute('/pda/task/:id', { id: 'b-reach:task1', source: 'evidence-b/pda-320-reachability.json', stage: 'after-final-source', sourceCommit: '66fa87e + 当前工作树', sourceSnapshot: null,
    observedUrl: '#/pda/task/1', viewport: '320x844', theme: 'light', screenshots: observation.screenshots.slice(0, 2), humanViewed: observation.visualReviewed === true, interaction: true,
    result: 'manual按钮首屏y763/h44/bottom807完整可达；scroll500文档不移动；打开输入获焦44px→空取消；无横溢出。未拣货/确认。', concreteResourceRead: true,
  })
  addRoute('/pda/putaway/:id', { id: 'b-reach:putaway2', source: 'evidence-b/pda-320-reachability.json', stage: 'after-final-source', sourceCommit: '66fa87e + 当前工作树', sourceSnapshot: null,
    observedUrl: '#/pda/putaway/2', viewport: '320x844', theme: 'light', screenshots: observation.screenshots.slice(2), humanViewed: observation.visualReviewed === true, interaction: false,
    result: '真实尚未收货说明与返回完整；无横溢出；未上架。', concreteResourceRead: true,
  })
}
if (fs.existsSync(path.join(dir, 'observations-crud-after.json'))) {
  for (const observation of read('observations-crud-after.json').routes) {
    const evidence = { id: `c-crud:${observation.route}`, source: 'observations-crud-after.json + coverage_inventory逐张44图细看声明', stage: 'after-before-focus-fix', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null,
      viewport: ['1440x900', '1024x900'], theme: 'light', screenshots: observation.screenshots, humanViewed: observation.humanViewed === true, interaction: true, result: `${observation.result}；真实Tab圈内/滚动/代表输入Escape→继续保留→放弃关闭→重开初态；原继续编辑焦点BODY缺陷是实际失败，后续source red/green及fresh GUI另列。`,
      businessWrite: false, checks: observation.checks,
    }
    addRoute(observation.route, evidence)
    addSurface(observation.route, routeMap.get(observation.route).source, 'BaseCrudPage', { ...evidence, id: `c-crud-use:${observation.route}` })
    // These are actual programmatic child callbacks used in the plastic form,
    // not its separate detail/repack dialogs or all shared Finder consumers.
    if (observation.route === '/plastic-boxes') for (const component of ['PickerField', 'WarehouseSelect', 'ProductFinder']) addSurface(observation.route, routeMap.get(observation.route).source, component, { ...evidence, id: `c-crud-use:plastic:${component}`, result: '实际打开商品Finder并确认选择+选择仓库，双变化与各单独变化Escape确认→继续保留→放弃；未创建。实际独立ProductFinderModal不等同通用FinderTable；只覆盖选品回填，不推广方向键。' })
    routeMap.get(observation.route).issues = [...routeMap.get(observation.route).issues.filter(item => item.id !== 'C-focus-resume'), { id: 'C-focus-resume', severity: 'P2', description: '继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留', result: 'BaseCrud最小回焦实现已真实组件red→green；当前基础Dialog统一修复；现场fresh复验待追加' }]
  }
}
if (fs.existsSync(path.join(dir, 'observations-focus-after.json'))) {
  const focus = read('observations-focus-after.json')
  for (const observation of focus.routes) {
    const evidence = { id: `c-focus:${observation.route}`, source: 'observations-focus-after.json + base-crud-gui-validation.md（本审查者8张逐图细看）', stage: 'after-focus-fix-before-final-radix-override', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, viewport: '1024x900', theme: 'light', screenshots: observation.screenshots, humanViewed: observation.humanViewed === true, interaction: true, businessWrite: false, result: `${observation.visualReview}；继续编辑回刚才的原字段并保留值；放弃回原新增button。塑料盒真实选品+仓库变化回原仓库combobox。`, checks: observation.checks, codeBinding: '产品焦点source当时版本；Radix新版override之前，之后只补关键复验，非最终依赖全部用方验收' }
    addRoute(observation.route, evidence)
    addSurface(observation.route, routeMap.get(observation.route).source, 'BaseCrudPage', { ...evidence, id: `c-focus-use:${observation.route}` })
    routeMap.get(observation.route).issues = routeMap.get(observation.route).issues.map(issue => issue.id === 'C-focus-resume' ? { ...issue, result: '真实组件自然red→green；fresh八用方GUI原字段回焦/保留值/放弃回原button均验证，1024浅色。原失败不改写；新依赖override后关键复验另列' } : issue)
  }
}
if (fs.existsSync(path.join(dir, 'observations-focus-extras.json'))) {
  const extra = read('observations-focus-extras.json')
  for (const observation of extra.routes) {
    const route = actualPattern(observation.route), evidence = { id: `c-focus-extras:${observation.route}`, source: 'observations-focus-extras.json + base-crud-gui-validation.md（本审查者3张逐图细看）', stage: 'after-focus-fix-before-final-radix-override', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, observedUrl: observation.route, viewport: '1024x900', theme: 'light', screenshots: observation.screenshots, humanViewed: observation.humanViewed === true, interaction: true, result: observation.result, businessWrite: false, concreteResourceRead: observation.route === '/procurement/1', codeBinding: extra.sourceBoundary }
    addRoute(route, evidence)
    if (route === '/procurement/:id') addSurface(route, 'frontend/src/components/shared/ProcurementSupplyDetails.tsx', 'Dialog', { ...evidence, id: 'c-focus-extras-use:procurement-supply' }, 'open')
    if (route === '/suppliers') addSurface(route, routeMap.get(route).source, 'BaseCrudPage', { ...evidence, id: 'c-focus-extras-use:supplier-visible-radix' })
    if (route === '/customers') addSurface(route, routeMap.get(route).source, 'CustomerFormDialog', { ...evidence, id: 'c-focus-extras-use:customer-draft' })
  }
}
// Final canonical Radix samples. Only explicitly exercised surfaces are mapped;
// the end date, other selectors and all other workspace pages remain untested.
for (const [file, prefix] of [['observations-workspace-final.json', 'c-workspace-final'], ['observations-c-final-shared.json', 'c-final-shared']]) {
  if (!fs.existsSync(path.join(dir, file))) continue
  const observations = read(file)
  for (const observation of observations.routes) {
    const route = actualPattern(observation.route)
    const evidence = { id: `${prefix}:${route}`, source: `${file} + 本审查者逐张人工细看声明`, stage: 'after-final-canonical-before-description-adjustment', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, observedUrl: observation.route, viewport: route === '/sale' ? '768x900' : '1024x900', theme: 'light', screenshots: observation.screenshots, humanViewed: observation.humanViewed === true, interaction: true, businessWrite: false, result: observation.result, samplingBoundary: observation.samplingBoundary ?? observations.probeBoundary, codeBinding: observations.sourceBoundary }
    addRoute(route, evidence)
    if (route === '/sale/new') {
      addSurface(route, 'frontend/src/layouts/AppLayout.tsx', 'WorkspaceTabs', { ...evidence, id: `${prefix}-use:workspace-close` })
      addSurface(route, 'frontend/src/components/shared/DirtyGuardDialog.tsx', 'ConfirmDialog', { ...evidence, id: `${prefix}-use:dirty-close` })
    }
    if (route === '/sale') {
      addSurface(route, 'frontend/src/pages/sale/index.tsx', 'SaleQueryDialog', { ...evidence, id: `${prefix}-use:sale-query` }, 'queryOpen')
      const startDate = data.surfaces.find(surface => surface.source === 'frontend/src/pages/sale/SaleQueryDialog.tsx' && surface.component === 'DatePicker' && surface.id.includes('#DatePicker:1:'))
      if (startDate) addSurface(route, startDate.source, 'DatePicker', { ...evidence, id: `${prefix}-use:sale-start-date`, specificCallId: startDate.id })
    }
    if (route === '/suppliers') {
      addSurface(route, routeMap.get(route).source, 'BaseCrudPage', { ...evidence, id: `${prefix}-use:supplier-visible-select` })
      addSurface(route, routeMap.get(route).source, 'SettlementTypeField', { ...evidence, id: `${prefix}-use:supplier-settlement` })
      addSurface(route, 'frontend/src/components/shared/BaseCrudPage.tsx', 'ConfirmDialog', { ...evidence, id: `${prefix}-use:supplier-discard` }, 'discardOpen')
    }
  }
}
for (const [file, prefix] of [['observations-fluid-final.json', 'root-fluid'], ['observations-fluid-scroll.json', 'root-fluid-scroll']]) {
  if (!fs.existsSync(path.join(dir, file))) continue
  for (const observation of read(file)) {
    const route = actualPattern(observation.route)
    const evidence = { ...observation, id: `${prefix}:${route}:${observation.viewport}`, source: `${file} + root逐张查看声明`, stage: 'after-fluid-floor-before-selection-preview-fix', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, observedUrl: observation.hash ?? observation.route, humanViewed: observation.humanViewed === true, result: observation.result ?? observation.visualReview, codeBinding: '四个真实fluid页面指定列/数据/尺寸，无selection列；后续B真实preview发现calc选择列均分和hover透字，需其最终复验，当前图不证明后续改动' }
    addRoute(route, evidence)
    addSurface(route, routeMap.get(route).source, 'DataTable', { ...evidence, id: `${prefix}-use:${route}:${observation.viewport}` })
  }
}
if (fs.existsSync(path.join(dir, 'evidence-b/sale-allocation-after.json'))) {
  const observation = read('evidence-b/sale-allocation-after.json')
  for (const [kind, component, index] of [['ship', 'ShipSelectDialog', 0], ['release', 'ReleaseAllocationDialog', 1], ['reserve', 'ReserveAllocationDialog', 2]]) {
    const sample = observation[kind], route = actualPattern(sample.route)
    const evidence = { id: `b-allocation:${kind}`, source: 'evidence-b/sale-allocation-after.json + implementation-b.md:销售分配增量', stage: 'after-final-source', sourceCommit: '66fa87e + 当前工作树', sourceSnapshot: null,
      observedUrl: sample.route, viewport: sample.viewport, theme: 'light', screenshots: [observation.screenshots[index]], humanViewed: observation.visualReviewed === true, interaction: true,
      result: `${kind}真实原单打开→输入${sample.qty}无效数量→disabled确认→正常取消；1024横向表格实际滚至数量列，不宣称整宽表同屏或真实pending/写入。`, componentTests: '销售组件当前3文件16例含新增13 red→green；pending/同帧连点/载荷冻结/失败保留为组件夹具，GUI未提交', concreteResourceRead: true, codeBinding: '三张无效数量图早于最后占库读取失败/仓库label追加；后两张真实abort/retry单列final-source。',
    }
    addRoute(route, evidence)
    addSurface(route, 'frontend/src/pages/sale/form/index.tsx', component, { ...evidence, id: `b-allocation-use:${kind}` })
  }
}
if (fs.existsSync(path.join(dir, 'evidence-b/sale-reserve-read-after.json'))) {
  const observation = read('evidence-b/sale-reserve-read-after.json'), route = '/sale/:id'
  const evidence = { id: 'b-reserve-read:sale3', source: 'evidence-b/sale-reserve-read-after.json + implementation-b.md', stage: 'after-final-source', sourceCommit: '66fa87e + 当前工作树', sourceSnapshot: null,
    observedUrl: observation.recovered.url, viewport: observation.recovered.viewport, theme: 'light', screenshots: observation.screenshots, humanViewed: observation.visualReviewed === true, interaction: true,
    result: observation.reviewScope, componentTests: '当前销售组件3文件16例；真实业务pending仍仅组件测试，无库存写入', concreteResourceRead: true,
  }
  addRoute(route, evidence)
  addSurface(route, 'frontend/src/pages/sale/form/index.tsx', 'ReserveAllocationDialog', evidence)
  addSurface(route, 'frontend/src/pages/sale/components/ReserveAllocationDialog.tsx', 'QueryErrorState', { ...evidence, id: 'b-reserve-read:error-call', result: '只在真实sale3的占库预览GET abort持续失败时出现，解除route后真实GET200重试；其他页QueryErrorState未推广' })
}
if (fs.existsSync(path.join(dir, 'a-final-screens.json'))) {
  const manifest = read('a-final-screens.json')
  if (manifest.images.length !== 11 || manifest.images.some(image => image.imageReviewed !== true || !fs.existsSync(path.join(root, image.path)))) throw new Error('A final reviewed manifest changed; inspect declaration')
  const index = new Map(manifest.images.map(image => [path.basename(image.path, '.png'), image.path.replace('docs/design-audit-2026-10-08/', '')]))
  const samples = [
    ['/settings/print-templates', ['a-final-templates-error-1024-light', 'a-final-templates-retry-1024-dark'], '真实GET400完整原格式错误/持久重试，点击重试仍原GET400/同错误；无伪空或旧表，没有放宽非法label；只读', 'QueryErrorState'],
    ['/accounting/invoices', ['a-final-invoices-abort-1024-light', 'a-final-invoices-abort-1024-dark', 'a-final-invoices-retry-empty-1024-dark'], '仅本会话GET invoices abort（status=null，非HTTP500）→原网络失败/重试，无共0或伪空；解除唯一拦截后同invoiceType1/page1/pageSize200 GET真实200空→才显示共0；真实库无发票，缓存旧表失败仅组件验证', 'QueryErrorState'],
    ['/accounting/invoices', ['a-final-invoice-date-calendar-1024-light', 'a-final-invoice-date-inner-escape-1024-light', 'a-final-invoice-date-discard-1024-light', 'a-final-invoice-date-resume-1024-dark'], '有效2031-01-02未blur输入：首Escape日历2→外层1/原invoiceDate焦点与值保留；次Escape未保存确认；继续回原日期/值保留，日期获焦日历再次打开；最后放弃，无保存', 'DatePicker'],
    ['/logistics', ['a-final-logistics-date-labels-1024-light', 'a-final-logistics-date-labels-1024-dark'], '查询两日期输入真实名称为创建日期（起/止）+打开日历选择，浅深可见；Escape取消。只名称，不推广所有筛选或两日历交互', 'DatePicker'],
  ]
  if (samples.flatMap(([, names]) => names).length !== 11) throw new Error('A final exact mapping changed')
  for (const [route, names, result, component] of samples) {
    const suffix = component === 'DatePicker' ? 'date' : 'read', evidence = { id: `a-final:${route}:${suffix}`, source: 'a-followup-overlays.md:最后稳定窗口 + a-final-screens.json（A声明逐图细看）', stage: 'after-final-source-before-final-radix-override', sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, viewport: '1024x768', theme: 'light + DOM模拟dark（非产品切换）', screenshots: names.map(name => index.get(name)), humanViewed: true, interaction: true, businessWrite: false, result, codeBinding: manifest.evidenceBoundary }
    addRoute(route, evidence)
    const source = route === '/logistics' ? 'frontend/src/pages/logistics/WaybillQueryDialog.tsx' : routeMap.get(route).source
    addSurface(route, source, component, { ...evidence, id: `a-final-use:${route}:${suffix}` })
    if (suffix === 'read') {
      routeMap.get(route).stateReview.error = { result, evidence: [evidence.id, route === '/accounting/invoices' ? 'a-final-invoices-read.json' : 'a-final-templates-read.json'] }
      if (route === '/accounting/invoices') routeMap.get(route).stateReview.empty = { result: '解除abort后真实同参数GET200到合法空；失败期间不画空；无历史有数据缓存GUI', evidence: [evidence.id] }
      else routeMap.get(route).issues = routeMap.get(route).issues.map(issue => issue.id === 'A-template-read' ? { ...issue, result: '自然组件red→green；真实GET400原错误与正常重试仍400已浅深细看，不放宽业务格式，既有详情仍受阻' } : issue)
    }
  }
}
if (fs.existsSync(path.join(dir, 'observations-root-final.json'))) {
  const observations = read('observations-root-final.json')
  if (observations.length !== 16) throw new Error('Root final declaration count changed; inspect before merging')
  for (const observation of observations) {
    const evidence = { ...observation, id: `root-final:${observation.requestedRoute ?? observation.route}:${observation.stage}`, sourceCommit: '66fa87e + 捕获时工作树', sourceSnapshot: null, source: `${observation.source ?? 'root实际操作与逐图查看声明'}；observations-root-final.json`, codeBinding: observation.stage === 'final-description-aria' ? 'Description收口后指定RF1浅深样本；其他用方不外推，aria-hidden-focus incomplete仍保留' : '当前指定样本；之后dependency override/窄表DataTable变动需关键补验，不自动升级全用方' }
    if (evidence.screenshots.some(name => !fs.existsSync(path.join(dir, name)))) throw new Error(`Root final screenshot absent: ${evidence.id}`)
    addRoute(observation.route, evidence)
    if (observation.route === '/login') {
      const login = routeMap.get('/login')
      login.actualView = '真实未认证登录正常/错误/空密码禁用代表状态已查看；旧认证跳转截图保留'
      login.uncoveredReason = '本批合成错误账号401、1024/768浅深代表态已验；未知结果、全部响应/原生认证/全键盘仍待指定证据'
      login.stateReview.error = { result: '真实未认证合成错误账号401；浅深原错误已看；未记录凭据', evidence: [evidence.id] }
      login.stateReview.disabled = { result: '真实空密码时提交禁用；其他禁用状态未推广', evidence: [evidence.id] }
    }
    if (observation.route === '/sale') {
      addSurface('/sale', 'frontend/src/pages/sale/index.tsx', 'SaleQueryDialog', { ...evidence, id: 'root-final-use:sale-query' })
      const start = data.surfaces.find(surface => surface.source === 'frontend/src/pages/sale/SaleQueryDialog.tsx' && surface.component === 'DatePicker' && surface.attributes.value === 'draft.startDate')
      if (start) addSurface('/sale', start.source, start.component, { ...evidence, id: 'root-final-use:sale-date-start', specificCallId: start.id })
    }
    if (observation.route === '/sale/new') for (const component of ['CustomerFinder', 'ProductFinder']) {
      const call = data.surfaces.find(surface => surface.source === 'frontend/src/pages/sale/form/index.tsx' && surface.component === component && surface.ownerFunction === 'CreateView')
      if (call) addSurface('/sale/new', call.source, component, { ...evidence, id: `root-final-use:sale-new:${component}`, specificCallId: call.id })
    }
    if (observation.route === '/supplier-refunds') {
      const call = data.surfaces.find(surface => surface.source === 'frontend/src/pages/supplier-refunds/index.tsx' && surface.component === 'RefundDetailDialog' && surface.attributes.row === 'manual')
      if (call) addSurface('/supplier-refunds', call.source, call.component, { ...evidence, id: `root-final-use:supplier-refund-manual-detail:${observation.stage}`, specificCallId: call.id })
      for (const [stage, file] of [['after-before-primary-hover-fix', 'root-supplier-detail-axe-after.json'], ['after-final-dark', 'root-supplier-detail-axe-final.json']]) {
        const axe = read(file).data
        register(routeMap.get('/supplier-refunds'), { id: `root-axe-history:${stage}`, source: file, stage, accessibility: { counts: axe.counts, violations: axe.violations, incomplete: axe.incomplete }, humanViewed: false, interaction: false, result: stage === 'after-final-dark' ? '37pass/0violations/2incomplete：aria-hidden-focus及aria-describedby需核；不是全部axe通过' : '历史27pass/1contrast violation/0incomplete，4.36<4.5；保留真实失败，不改写为最终成功' })
      }
      for (const file of observation.accessibilityFiles ?? []) {
        const axe = read(file).data
        register(routeMap.get('/supplier-refunds'), { id: `root-axe-history:${file}`, source: file, stage: observation.stage, accessibility: { counts: axe.counts, violations: axe.violations, incomplete: axe.incomplete }, humanViewed: false, interaction: false, result: 'Description收口后的浅/深各37pass/0violations/1incomplete aria-hidden-focus；另有实际Tab/ShiftTab/Escape回原button限定样本，不将incomplete自动算通过' })
      }
    }
    if (observation.route === '/procurement/:id' && observation.humanViewed) addSurface(observation.route, 'frontend/src/components/shared/ProcurementSupplyDetails.tsx', 'Dialog', { ...evidence, id: 'root-final-use:procurement-coverage' }, 'open')
  }
  const dynamic = read('erp-dynamic-review.json')
  for (const record of dynamic.routes) {
    const resources = observations.filter(item => item.route === record.route && item.concreteResourceRead && item.requestedRoute)
    if (resources.length) {
      record.concretePath = resources.at(-1).requestedRoute
      record.actualResourceVerified = true
      record.actualView = resources.some(item => item.humanViewed) ? '具体资源代表状态人工细看；未覆盖全详情/动作' : '实际具体路径/标题回读+布局总览；详情细节未逐项查看'
      record.verification = '实际资源路径/标题回读；不是全字段、API网络日志、编辑或业务写入验收'
      record.resourceEvidence = resources.map(item => ({ source: 'observations-root-final.json', path: item.requestedRoute, observedUrl: item.observedUrl, headings: item.headings, overviewReviewed: item.overviewReviewed, humanViewed: item.humanViewed, result: item.result }))
      record.remainingBoundary = record.route === '/settings/print-templates/:id' ? '仅资源路径/编辑标题回读；既有非法label格式读400阻碍编辑，不视为完整模板详情通过' : '其余子区/弹窗、七态、权限/隐藏迟到、业务写入与其他尺寸仍待验'
    } else if (record.route === '/transfer/:id') record.remainingBoundary = '根本批新仓3资源GET403；当前scope仅仓1，不扩权凑验收。缺合法在范围合成调拨资源'
    else record.remainingBoundary = '本批没有明确合法具体物流详情资源读取证据，保留动态缺口'
  }
  dynamic.source = 'routes.json/当前源码 + dynamic-fixtures.json/observations-root-final.json的精确合成资源路径/标题回读声明；不读取auth/env或生产数据'
  dynamic.boundary = 'path=null/pattern保留动态注册语义；concretePath只填root实际回读路径。actualResourceVerified仅资源存在/路径标题，不等于全详情、网络API或写流程验收'
  writeOrCheck('erp-dynamic-review.json', JSON.stringify(dynamic, null, 2) + '\n')
}

const changed = new Set([
  execFileSync('git', ['diff', '--name-only', '--', 'frontend/src'], { cwd: root, encoding: 'utf8' }),
  execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'frontend/src'], { cwd: root, encoding: 'utf8' }),
].flatMap(output => output.trim().split('\n').filter(Boolean)))
if (fs.existsSync(path.join(dir, 'findings.md'))) {
  const findingRows = new Map(fs.readFileSync(path.join(dir, 'findings.md'), 'utf8').split('\n').filter(line => /^\| F\d{2} \/ P[12]/.test(line)).map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim()), [id, severity] = cells[0].split(' / ')
    return [id, { id, severity, description: cells[1], implementation: cells[3], evidenceBoundary: cells[4], source: 'findings.md', result: '来源/调用范围已映射并对照独立审查；是否现场复验及剩余状态以本记录evidence/stateReview为准，不由共享改动推导通过' }]
  }))
  if (findingRows.size !== 17) throw new Error('Expected F01–F17; inspect changed findings before mapping')
  const sourceText = new Map()
  for (const source of new Set([...data.routes, ...data.surfaces].flatMap(record => [record.source, record.definition?.source]).filter(source => source?.startsWith('frontend/src/') && /\.[jt]sx?$/.test(source)))) {
    const absolute = path.resolve(root, source)
    if (!absolute.startsWith(path.join(root, 'frontend/src') + path.sep)) throw new Error('Finding source outside allowlist')
    sourceText.set(source, fs.readFileSync(absolute, 'utf8'))
  }
  const crudSources = new Set(['/suppliers', '/carriers', '/warehouses', '/locations', '/racks', '/sorting-bins', '/plastic-boxes', '/finance/expense-categories'].map(route => routeMap.get(route).source))
  const sourceMatches = (record, regex) => [record.source, record.definition?.source].some(source => regex.test(source ?? ''))
  const draftSources = /\/BaseCrudPage\.tsx$|\/useDialogDraftGuard\.ts$|\/customers\/components\/CustomerFormDialog\.tsx$|\/users\/components\/UserFormDialog\.tsx$|\/accounting\/invoices\/index\.tsx$|\/approvals\/flows\.tsx$/
  const rules = [
    ['F01', record => sourceMatches(record, /\/pages\/(refunds|purchase|customers|returns|finance\/(accounts|transactions)|accounting\/(vouchers|invoices)|settings\/print-templates)\/(?:index\.tsx)$/)],
    ['F02', record => sourceMatches(record, /\/pages\/pda\/(receive|picking|task|check|pack)\.tsx$|\/ReserveAllocationDialog\.tsx$/)],
    ['F03', record => crudSources.has(record.source) || sourceMatches(record, /\/BaseCrudPage\.tsx$|\/pages\/(customers|purchase)\/index\.tsx$/)],
    ['F04', record => sourceMatches(record, draftSources) || sourceMatches(record, /\/refunds\/components\/RefundDetailDialog\.tsx$|\/(ShipSelectDialog|ReleaseAllocationDialog|ReserveAllocationDialog)\.tsx$/)],
    ['F05', record => crudSources.has(record.source) || sourceMatches(record, draftSources)],
    ['F06', record => sourceMatches(record, /\/usePdaScanner\.ts$|\/PdaScanner\.tsx$/)],
    ['F07', record => sourceMatches(record, /\/pages\/(refunds\/components\/RefundDetailDialog|supplier-refunds\/(CreateRefundPage|RefundDetailDialog|index))\.tsx$/)],
    ['F08', record => sourceMatches(record, /\/pages\/(refunds|supplier-refunds)\/index\.tsx$/)],
    ['F09', record => sourceMatches(record, /\/SaleOrderHeaderFields\.tsx$|\/DatePicker\.tsx$|\/pages\/(refunds\/(?:components\/)?CreateRefundDialog|finance\/accounts\/index|users\/components\/UserFormDialog|accounting\/invoices\/index|approvals\/flows|settings\/pda-devices\/index|finance\/transactions\/index|.*QueryDialog)\.tsx$/)],
    ['F10', record => sourceMatches(record, /\/WorkspaceTabs\.tsx$|\/PaymentsView\.tsx$/)],
    ['F11', record => sourceMatches(record, /\/finder\/(FinderTable|FinderModal|CustomerFinder|SupplierFinder)\.tsx$/)],
    ['F12', record => [record.source, record.definition?.source].some(source => /\btext-(?:success|warning|danger|info)-ink\b/.test(sourceText.get(source) ?? ''))],
    ['F13', record => [record.source, record.definition?.source].some(source => /\bexpandableText\b/.test(sourceText.get(source) ?? ''))],
    ['F14', record => sourceMatches(record, /\/pages\/supplier-refunds\/(index|CreateRefundPage|RefundDetailDialog)\.tsx$/)],
    ['F15', record => sourceMatches(record, /\/components\/(ui\/dialog|shared\/(AppDialog|ConfirmDialog|BaseCrudPage|DatePicker))\.tsx$|\/useDialogFocusReturn\.ts$/)],
    ['F16', record => sourceMatches(record, /\/pages\/procurement\/detail\.tsx$|\/ProcurementSupplyDetails\.tsx$/)],
    ['F17', record => sourceMatches(record, /\/DataTable\.tsx$/)],
  ]
  const surfaceIds = new Map(data.surfaces.map(surface => [surface.id, surface]))
  for (const record of [...data.routes, ...data.surfaces]) {
    record.issues = record.issues.filter(issue => typeof issue !== 'object' || !/^F\d{2}$/.test(issue.id ?? ''))
    const matched = rules.filter(([, applies]) => applies(record) || record.subSurfaces?.some(id => applies(surfaceIds.get(id)))).map(([id]) => id)
    if (matched.length) record.issues = record.issues.filter(issue => issue !== '尚未审查')
    for (const id of matched) record.issues.push({ ...findingRows.get(id), mappingBoundary: '此源文件/定义/实际可达调用在问题范围；静态影响关系不代表本页已复现缺陷或GUI已通过' })
    if (matched.length) record.manual.sourceReview = `findings.md ${matched.join('/')}；shared-components-review.md独立范围及A/B所属源审查；其余状态/用方现场仍待evidence`
  }
}
for (const record of [...data.routes, ...data.surfaces]) {
  const direct = changed.has(record.source)
  const dependencies = record.subSurfaces ? [...new Set(data.surfaces.filter(surface => record.subSurfaces.includes(surface.id)).flatMap(surface => [surface.source, surface.definition?.source]).filter(source => changed.has(source)))] : [record.definition?.source].filter(source => changed.has(source))
  record.changeEvidence = [...new Set([...(direct ? [record.source] : []), ...dependencies])]
  record.modified = direct ? '本调用源/页面源已修改；不等于验证通过' : dependencies.length ? '共享依赖已修改；本用方仍须独立复验' : '本源文件未修改'
  if (record.actualView === '未查看' && record.evidence.length) record.actualView = '已捕获；人工细看待核实'
  if (record.route !== '/login') {
    if (record.kind === 'alias') record.uncoveredReason = '旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为'
    else if (record.route === '/transfer/:id') record.uncoveredReason = '本批新仓3合成资源API回读403，当前scope仅仓1（erp-dynamic-review.json）；未扩大权限。尚缺合法在范围的具体调拨详情GUI，API403不替代页面权限呈现验收。'
    else if (record.route === '/logistics/:id') record.uncoveredReason = '本批尚无合法具体运单ID/详情读取证据；不能以销售ID替代运单ID；未为视觉验收调用真实承运商取号。'
    else if (record.route === '/pda/ship/:id') record.uncoveredReason = '已看指定ID地址的扫描初态，但ship源码不消费routeID；没有该任务详情/可执行阶段/真实出库流程验收。'
    else if (record.kind === 'dynamic' && !record.evidence.some(item => item.concreteResourceRead !== false && item.observedUrl?.match(/\/\d+(?:[/?#]|$)/))) record.uncoveredReason = '动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。'
    else record.uncoveredReason = record.evidence.length ? '证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验' : '未打开此业务调用表面；静态可达/共享测试/页面截图不能代替实际调用条件验收'
  }
  record.stateReview ??= Object.fromEntries(states.map(state => [state, { result: '未触发验收', evidence: [] }]))
}
data.evidenceIntegration = {
  method: '固定人工核对索引合入明确截图/DOM/交互记录；依据A/B/root/本审查者声明指定证据层级。不从文件存在、import、组件测试或其他用方推导通过。Root108入口仅缩略图布局概览；A固定67+41+11=119图及本审查者44+11+9=64图逐张细看；后续新截图只随明确索引追加。',
  sources: ['observations-before.json:92入口捕获；root已查看contact-before01–08入口总览', 'observations-after.json:108requested paths；root已查看contact-after01–12布局概览，捕获时login为认证跳转', 'observations-fluid-final/scroll.json:12四fluid页面768/1024/1440布局图+4实际右端滚动/回左图均root逐张看；无selection列，不升级B后续preview修正为已验', 'observations-root-final.json:10 ERP合成动态路径/标题回读仍仅overview；5代表状态含未认证login4图、sale日期、Finder/草稿、供应商退款、合法procurement1详情，第16追加Description收口后浅深各0viol/1incomplete；旧1viol与0viol/2incomplete都保留', 'assessment-a.md:20before截图已查看，表单只打开/取消', 'a-after.md + a-gui-followup.md:固定46+21=67图逐张细看；真实列表错误/重试/标签与最终ink/nav，组件11文件56例', 'a-followup-overlays.md + a-followup-screens.json:固定25+16=41图逐张细看；独立浮层指定入口/标签/草稿/空态/受阻；追加5文件42组件例/11路径lint0/完整tsc0', 'a-final-screens.json + 脱敏read JSON:固定11图逐张细看；真实模板400/重试、invoice abort→200、有效日期未blur/两层Escape/恢复、物流日期名称；override前样本保留', 'a-backend-read.md + a-api-read-green.json:退款真实API红到绿9例；PDA实际/my与/my-sku-summary及代表报表200仅API证据，错误/my-tasks探测排除', 'assessment-b.md + observations-pda-before.json:19PDA路由捕获与指定样本细看', 'implementation-b.md + observations-pda-after/final.json + evidence-b/pda-320-reachability.json:明确320/部分390实际阶段与交互，193组件例；原生/业务提交未验', 'observations-crud-after.json:8用方44图逐张细看与限定草稿交互，未提交；BODY回焦缺陷保留', 'observations-focus-after/extras.json:8+3图逐张细看；8用方回原字段/新增button、实际供应商仅Radix变化、客户guard兼容、合法计划受控浮层回焦；override前版本，不推广最终依赖全GUI', 'observations-workspace-final/c-final-shared.json:最终canonical9图逐张看；客户两商品qty1.25/2备注切换保留、真实close取消/确认、等autoFocus返回原close按钮；768日期2→1→0返回、1024仅Radix变化保留/回combobox/放弃；Description小收口前指定样本', 'workspace-tabs-validation.md:指定工作区键盘/草稿/axe测试与真实GUI', 'shared-components-review.md:独立源码/调用链与最小回归；未自动推广业务用方GUI'],
  sharedTests: [
    { source: 'dialog.focus + BaseCrudPage.draft + independentDialogs.draft + WorkspaceTabs.keyboard + DatePicker.accessibility', result: '最终canonical dismissable-layer1.1.13/focus-scope1.1.16真实组件5文件47例通过；保留1.1.19 nested Escape自然失败历史；只证明这些行为夹具，不提升全部GUI', log: '/tmp/flowcube-dialog-focus-final-green.log' },
    { source: 'DataTable.test.tsx + statusTone.contrast.test.ts + BaseCrudPage.feedback.test.tsx + BaseCrudPage.draft.test.tsx', result: '较早独立最小回归4文件41例通过；BaseCrud真实Radix BubbleInput、取消/隐藏pending/关闭保护和权限fixture；不是最终全量或全GUI', log: '/tmp/flowcube-shared-independent-review-final.log' },
    { source: 'dialog.focus + BaseCrudPage.draft + independentDialogs.draft + WorkspaceTabs.keyboard', result: '较早override前公共Dialog/AppDialog真实回焦、BaseCrud/A草稿handler兼容、标签键盘：4文件44例通过；AppDialog单独自然red，7路径scoped lint0；fresh GUI另列，不能全用方推广', log: '/tmp/flowcube-dialog-focus-green.log' },
  ],
  pending: [
    'A/B已明确的GUI、API、组件测试各自独立；低权限/详情延迟/缓存反例主要是组件夹具；A固定新增41+11图已合入指定入口；最终canonical后关键GUI9图已明确追加，不自动推广全部用方；Description收口RF1浅深/Tab回焦/0viol1incomplete已另加；其他ARIA用方仍待逐用方；DataTable最终选择夹具5+2图另有组件范围证据，不外推业务路线。',
    '/login 旧总览为认证跳转已保留；root-final真实未认证正常/401/空密码禁用浅深4图已合入；未知及全键盘未验。/pda/login仍待未登录会话验收。',
    '全部26动态pattern继续逐权限/阶段/子表面验收；11 ERP具体路径/标题已回读，其中10仅overview、procurement1代表详情细看；transfer403/logistics缺合法fixture保留；receive2、putaway1/2、task1为明确读取样本；check/pack1仅阶段禁止；ship1仅不消费ID的扫描初态，不能代表动态详情或执行流程。',
    `${data.surfaces.length}表面是候选调用点；没有指定记录的弹窗、抽屉、选择器、状态用方继续未查看。新增调用点也保持待验。`,
    '备注11调用方除实际sales样本外逐用方键盘展开/收起、长文、虚拟列表、查询切换及窄屏待验。',
    'BaseCrud8用方已限定真实代表输入/Tab/Escape/继续/放弃/重开，塑料盒两回调及各单独变化实际确认保留；原BODY失败与8用方1024浅色fresh回焦成功分别保留，最终canonical供应商仅Radix变化和salesclose/日期关键样本已追加。pending Portal/遮罩、隐藏迟到成功、逐权限GUI仍待验，组件测试不替代。',
    'statusTone对比计算证明指定token背景；94文本颜色用方各自背景、alpha、浅深与语义不能由计算测试统一通过。',
    'Android广播/相机/软键盘/实体返回键、Windows原生弹窗、物理打印、CI/生产/发布均无本清单验收证据。',
  ],
}
if (fs.existsSync(path.join(dir, 'evidence-b/fluid-selection-preview.json'))) {
  const preview = read('evidence-b/fluid-selection-preview.json')
  data.evidenceIntegration.componentPreviews = [{ id: 'b-fluid-selection-preview:DataTable', source: 'evidence-b/fluid-selection-preview.json + fluid-selection-final-dom.json + implementation-b.md', stage: 'after-supported-percent-and-opaque-hover', scope: preview.scope, humanViewed: preview.componentChecks.every(check => check.manuallyViewed === true) && preview.scrollInputBoundary.auxiliaryScreenshotsManuallyViewed === true, interaction: true, screenshots: [...preview.componentChecks.map(check => check.screenshot), ...preview.scrollInputBoundary.auxiliaryScreenshots], checks: preview.componentChecks, counterexamples: preview.chromeCounterexamples, harnessAttempts: [preview.initialAttempt, preview.secondAttempt], tests: preview.fixValidation, businessPageAcceptance: preview.businessPageAcceptance, apiWrites: preview.apiWrites, scrollInputBoundary: preview.scrollInputBoundary, codeBinding: '真实组件正常reload后源，最终列DOM未覆写；只改原生scrollLeft验证布局，未证明物理横轮；没有业务路线用方验收' }]
  data.evidenceIntegration.sources.push('evidence-b/fluid-selection-preview/final-dom.json:最终5+2组件夹具图B逐张细看，56px选择/60:20:20归一业务权重/原生checkbox/opaque hover/表内scrollLeft；保留calc均分与透字反例、403/未挂载harness；不是4业务页面或物理横轮验收')
}
data.evidenceIntegration.pending.push(`尚无人工细看或入口总览声明的${data.routes.filter(route => !route.evidence.some(item => item.humanViewed || item.overviewReviewed)).length}个路由（部分仅自动捕获）：${data.routes.filter(route => !route.evidence.some(item => item.humanViewed || item.overviewReviewed)).map(route => route.route).join('、')}。具体动态阶段/权限原因与静态只捕获状态分别保留，不称全部入口已验收。`)
// A compact lookup preserves the exact record/source association for later audits.
const indexed = new Map()
for (const record of [...data.routes, ...data.surfaces]) for (const evidence of record.evidence ?? []) {
  const item = indexed.get(evidence.id) ?? { id: evidence.id, source: evidence.source, stage: evidence.stage, observedUrl: evidence.observedUrl ?? null, screenshots: evidence.screenshots ?? [], humanViewed: evidence.humanViewed === true, overviewReviewed: evidence.overviewReviewed === true, interaction: evidence.interaction === true, codeBinding: evidence.codeBinding ?? null, recordIds: [] }
  item.recordIds.push(record.id ?? record.route)
  indexed.set(evidence.id, item)
}
data.evidenceIndex = [...indexed.values()].sort((a, b) => a.id.localeCompare(b.id))
for (const preview of data.evidenceIntegration.componentPreviews ?? []) data.evidenceIndex.push({ id: preview.id, source: preview.source, stage: preview.stage, observedUrl: null, screenshots: preview.screenshots, humanViewed: preview.humanViewed, overviewReviewed: false, interaction: preview.interaction, codeBinding: preview.codeBinding, recordIds: ['component-preview:DataTable'], businessPageAcceptance: false })
writeOrCheck('coverage.json', serializeInventory(data))
if (stale.length) { process.stderr.write(`Merged evidence stale: ${stale.join(', ')}\n`); process.exitCode = 1 }
else process.stdout.write(`${checkOnly ? 'Checked' : 'Merged'} explicit evidence into ${data.routes.length} routes and ${data.surfaces.length} candidate calls${checkOnly ? '' : '; run inventory.mjs to render'}.\n`)
