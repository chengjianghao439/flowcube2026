# 抵减资产报表方向修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to execute this plan task-by-task. 本计划只覆盖总计划批次A；按当前会话授权顺序执行，不启动子代理，不合main、不发版。

**Goal:** 单体与合并资产负债表按资产借方净额显示累计折旧等抵减项目，修正原值100、折旧10被错误算成110的问题。

**Architecture:** 保持现有SQL、科目属性、凭证与数据接口，只调整两个资产分支的列报符号。明细账仍按科目正常余额方向展示；负债、权益、损益、期间/红冲和现金流口径不在本批改写。使用真实service与合成查询结果的离线回归，随后独立库和真实页面验证。

**Tech Stack:** Node22 / CommonJS、node:test、VM、mysql2、现有会计回归、ERP浏览器。

---

## 文件地图

| 路径 | 处理 |
| --- | --- |
| `backend/src/modules/accounting/accounting.ledger.service.js:273–278` | 单体资产金额用 d−c，保留返回字段 |
| `backend/src/modules/accounting/consolidation.service.js:63–68` | 汇总资产金额用 d−c，保留分组/账套来源 |
| `tests/accounting-statement-balances.test.js` | 新增真实service的离线金额及隔离/失败回归 |
| `package.json` | 新测试追加到已有test:accounting |
| `docs/finance-permission-time.md` | 同批同步资产列报、反向验证及验收边界 |

`.github/workflows/test.yml:616` 当前已调用 `npm run test:accounting`，不另造CI脚本。执行时核对引用是否仍成立。

## Task 1：现场与隔离

- [x] 核对当前 `git status --short --branch`、`git worktree list --porcelain`、完整HEAD及相关diff；保留未知改动。
- [x] 原样保留 `codex/desktop-ibm-style`。使用工作树流程在确认的主线上建立建议分支 `codex/accounting-report-correctness`；先核查该任务已有合适工作树，避免重复创建。
- [x] 加载项目环境，使用Node22。当前核查main为 `54cef45522212f37c9a7fb1152d66e7fce7513ec`，两个目标service与核查分支2b8a949一致；执行时如主线变化，先重新复现。

```bash
if [ -f "$HOME/.config/flowcube/dev-env.sh" ]; then source "$HOME/.config/flowcube/dev-env.sh"; fi
node --version
git status --short --branch
git diff -- backend/src/modules/accounting/accounting.ledger.service.js backend/src/modules/accounting/consolidation.service.js
```

本任务不对共享或生产库运行迁移、不加载真实backend/.env、不触碰真实账款。仅在本批归属可证明的独立空库按既有 bootstrap-new-database 流程初始化测试结构，不新增或修改产品迁移；不把合成查询结果称为数据库验收。

## Task 2：先写会因原错误失败的回归

- [x] 创建以下 `tests/accounting-statement-balances.test.js`。金额和等式分别断言，避免仅把balanced改成true也能通过。

```javascript
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const plain = value => JSON.parse(JSON.stringify(value))
const row = (code, category, balance_dir, d, c) => ({
  code, name: code, category, balance_dir, d: String(d), c: String(c),
})
const normal = amount => [row('1601', 1, 1, amount, 0), row('2202', 2, 2, 0, amount)]
const depreciated = (cost, depreciation) => [
  ...normal(cost), row('1602', 1, 2, 0, depreciation), row('660203', 6, 1, depreciation, 0),
]

function reports(byCompany = { 1: [] }, failure = null) {
  const calls = []
  const pool = { query: async (sql, params = []) => {
    calls.push({ sql, params: plain(params) })
    assert.match(sql, /^\s*SELECT\b/i, 'fixture must never permit writes')
    if (failure) throw failure
    if (sql.includes('FROM acct_companies')) {
      return [Object.keys(byCompany).map(id => ({ id: Number(id), code: `C${id}`, name: `合成账套${id}` }))]
    }
    assert.match(sql, /FROM acct_accounts a/)
    assert.match(sql, /a\.company_id\s*=\s*\?/)
    assert.match(sql, /a\.is_leaf\s*=\s*1/)
    return [plain(byCompany[Number(params.at(-1))] || [])]
  } }
  function load(name, overrides = {}) {
    const filename = path.join(__dirname, '../backend/src/modules/accounting/', name)
    const real = createRequire(filename), module = { exports: {} }
    let source = fs.readFileSync(filename, 'utf8')
    if (process.env.ACCOUNTING_REPORT_MUTANT === 'natural_asset') {
      const marker = 'const assetAmount = round2(Number(r.d) - Number(r.c))'
      assert.equal(source.split(marker).length - 1, 1, 'mutation must replace exactly one asset calculation')
      source = source.replace(marker, 'const assetAmount = b')
    }
    vm.runInNewContext(source, {
      module, console,
      require: id => id === '../../config/db' ? { pool } : Object.hasOwn(overrides, id) ? overrides[id] : real(id),
    }, { filename })
    return module.exports
  }
  const ledger = load('accounting.ledger.service.js')
  const group = load('consolidation.service.js', { './accounting.ledger.service': { periodRange: ledger.periodRange } })
  return {
    calls,
    single: companyId => ledger.getBalanceSheet({ period: '202610', companyId }),
    group: () => group.getConsolidatedBalanceSheet({ period: '202610', groupId: 1 }),
  }
}

const cases = [
  { name: 'empty', rows: [], asset: 0, liability: 0, equity: 0 },
  { name: 'ordinary asset', rows: normal(100), asset: 100, liability: 100, equity: 0 },
  { name: 'depreciation reduces asset', rows: depreciated(100, 10), asset: 90, liability: 100, equity: -10, contra: -10 },
  { name: 'negative net asset stays visible', rows: depreciated(10, 12), asset: -2, liability: 10, equity: -12, contra: -12 },
  { name: 'credit asset balance stays negative', rows: [row('1002', 1, 1, 0, 10), row('2202', 2, 2, 10, 0)], asset: -10, liability: -10, equity: 0 },
  { name: 'cent amounts retain two-place result', rows: depreciated(100.01, 0.01), asset: 100, liability: 100.01, equity: -0.01, contra: -0.01 },
  { name: 'reversed depreciation nets to zero', rows: [...normal(100), row('1602', 1, 2, 10, 10), row('660203', 6, 1, 10, 10)], asset: 100, liability: 100, equity: 0 },
]
function check(result, expected) {
  assert.equal(result.assetTotal, expected.asset)
  assert.equal(result.liabTotal, expected.liability)
  assert.equal(result.equityTotal, expected.equity)
  assert.equal(result.liabEquityTotal, expected.asset)
  assert.equal(result.balanced, true)
  if (expected.contra !== undefined) assert.equal(result.assets.find(x => x.code === '1602')?.amount, expected.contra)
}
for (const kind of ['single', 'group']) for (const sample of cases) {
  test(`${kind}: ${sample.name}`, async () => {
    const f = reports({ 1: sample.rows })
    const result = kind === 'single' ? await f.single(1) : await f.group()
    check(result, sample)
    assert.equal(f.calls.length, kind === 'single' ? 1 : 2)
  })
}
test('company isolation and grouped sum both retain contra-asset sign', async () => {
  const f = reports({ 1: depreciated(100, 10), 2: depreciated(200, 20) })
  check(await f.single(1), { asset: 90, liability: 100, equity: -10, contra: -10 })
  check(await f.single(2), { asset: 180, liability: 200, equity: -20, contra: -20 })
  check(await f.group(), { asset: 270, liability: 300, equity: -30, contra: -30 })
})
for (const kind of ['single', 'group']) test(`${kind}: read error never becomes a zero success`, async () => {
  const f = reports({ 1: normal(100) }, Error('CONTROLLED_REPORT_READ_FAILURE'))
  await assert.rejects(kind === 'single' ? f.single(1) : f.group(), /CONTROLLED_REPORT_READ_FAILURE/)
})
```

- [x] 在原实现运行红例，预期至少单体/合并的折旧样例出现实际110、期望90；记录真实失败输出，不先改断言。

```bash
node --test tests/accounting-statement-balances.test.js
```

## Task 3：最小实现，禁止修改事实账

- [x] 在 `accounting.ledger.service.js` 的 `getBalanceSheet` 循环内，替换资产分支；其余分支保持原样：

```javascript
if (r.category === 1) {
  const assetAmount = round2(Number(r.d) - Number(r.c))
  if (assetAmount) assets.push({ code: r.code, name: r.name, amount: assetAmount })
  assetTotal += assetAmount
}
```

- [x] 在 `consolidation.service.js` 的 `getConsolidatedBalanceSheet` 循环内使用同一资产分支：

```javascript
if (r.category === 1) {
  const assetAmount = round2(Number(r.d) - Number(r.c))
  if (assetAmount) assets.push({ code: r.code, name: r.name, amount: assetAmount })
  assetTotal += assetAmount
}
```

超额折旧的样例只检查历史异常的只读呈现，不表示允许新业务超提折旧。这里刻意不抽取新的跨业务金额工具。两处均只有资产项目符号发生变化，保留既有round2、SQL聚合、DTO、原红冲相抵、损益归期及正常余额方向的科目明细。

- [x] 重跑新测试，预期17项通过；若数量因后续补充变化，以实际输出为准。
- [x] 反向验证：仅在VM加载时临时恢复原“正常方向余额作为资产金额”错误，不改真实源文件。预期命令非0且折旧样例再次110≠90，随后无环境变量运行恢复全绿。

```bash
node --test tests/accounting-statement-balances.test.js
ACCOUNTING_REPORT_MUTANT=natural_asset node --test tests/accounting-statement-balances.test.js
node --test tests/accounting-statement-balances.test.js
```

## Task 4：接入既有CI与同步说明

- [x] 用以下幂等编辑将测试追加到既有 `test:accounting`，其余脚本不改：

```javascript
const fs = require('node:fs')
const filename = 'package.json'
const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'))
const target = 'tests/accounting-statement-balances.test.js'
if (!pkg.scripts['test:accounting'].includes(target)) {
  pkg.scripts['test:accounting'] += ` ${target}`
}
fs.writeFileSync(filename, JSON.stringify(pkg, null, 2) + '\n')
```

- [x] 在 `docs/finance-permission-time.md` 新增本批口径段落：

> 资产负债表及账套汇总表的资产项目使用借方累计减贷方累计，累计折旧等抵减项目保留负号。该列报符号不改变科目正常余额方向、原凭证或资金事实。balanced只表达报表会计等式，不代表业务来源完整或已通过审计。离线反例、独立库和浏览器证据分别记录，不互相替代。

- [x] 检查根CI仍从原路径执行 `test:accounting`；新增测试不能孤立留在仓库而不运行。

## Task 5：统一验证与真实页面验收

- [x] 离线验证统一跑一轮，不在每个小改后重复全量：

```bash
npm run test:accounting
npm --prefix backend run lint
npm run test:agents-md-guard
git diff --check
```

- [x] 用本批归属可证明的独立MySQL实例验证真实查询：按当前迁移建测试库，使用合成账套与平衡凭证；核对新增折旧、红冲相抵、截至期间、主账套/子账套范围及空期。所有写入只在本批测试实例；无生产/共享库访问。
- [x] 同一查询比较修前/修后原始借贷合计和报表金额。原值100、累计折旧10时，资产栏依次100、−10、合计90；负债100、权益−10；原凭证明细和资金流水校验值完全不变。
- [x] 浏览器真实打开 `/accounting/reports` 的资产负债表与 `/accounting/consolidation`，验证负号、总计、等式标记、切换期间/账套、空态与失败重试。只有mock/合成HTTP条件时必须明确标注，不能代替独立库结果。
- [x] 浏览器会话使用稳定任务名 `flowcube-accounting-report-correctness`，结束后close并回读session list；只停止本任务创建的服务。
- [ ] 准备正式发布前，按项目规定统一补足全量回归；本批不触发发布。若执行过程中发现需要改前端，另外运行前端lint、`tsc -b`、桌面构建及受影响测试，不借后端绿灯省略。

## Task 6：自审、提交与交付

- [x] 审diff确认只有两个资产分支、测试/脚本和对应说明；`balanced`仍由实际合计比较得到，权益未作为倒算差额。
- [x] 确认没有SQL UPDATE/DDL、迁移、历史修数、凭证重生、反结账、权限变化、PDA/打印或样式分支改动。
- [x] 提交前列出实际路径与用途，仅暂存已核对文件。建议一个提交：`fix(accounting): subtract contra-assets in balance sheets`。
- [x] 提交/推送按执行时授权；不合main、不打tag、不发版。
- [x] 交付报告列出基线/提交哈希、文件/行号、红绿与变异失败、独立库结果、截图和未覆盖。若独立库或浏览器未完成，写未完成，不能把VM17项当成全链路通过。


## 执行记录（2026-10-26）

实现、17项红绿/变异回归、238项会计套件、后端lint、独立MySQL与真实API/页面金额验证已完成。页面失败态已检查但未通过：单体持续加载，汇总显示零值与“不平”；已记录到批次B，不把页面整体验收称为通过。仅做本地提交，不推送、不合并、不发布；发版前全量仍待执行。完整证据见 [本批报告](../../accounting-report-correctness-2026-10-26.md)。

## 回退与上线门槛

- 验证失败时停在修复分支继续定位，不提交错误补偿分录、不自动反结账或修数。
- 该修复没有数据迁移或账务写入。若独立授权上线后出现新问题，按原发布流程回退应用提交；凭证与资金记录原样保留，不做数据层回滚。
- 回退意味着抵减资产报表问题重新处于未修复状态，须在交付记录中明示，不能把回退当成正确性验收通过。
- 真实历史账套的当前报表应从既有分录自然得到修正；若原分录本身有错，另走原会计更正流程，本批不替代会计判断。
