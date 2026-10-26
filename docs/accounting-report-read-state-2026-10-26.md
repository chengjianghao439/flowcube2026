# 会计报表失败态与重试修复

2026-10-26。用户追加授权的两处失败态已修复：单体资产负债表读取失败显示明确错误与“重试”；合并报表按区域呈现错误，失败区域不再显示默认零值与“不平”。成功空期仍显示真实零值。

## 基线与改动

在 `codex/accounting-report-correctness` 的 `61d598cee862f9b53e54e2dd36b56ae483ee1dd7` 之后追加本地提交，未 rebase、推送、合并或发布。本轮只改两页呈现和测试/文档，不改后端、API、金额、权限、查询条件或全局重试策略；批次 B 的其余能力说明、C/D 的会计政策仍未实施。

| 文件/行号 | 修改与依据 |
| --- | --- |
| `frontend/src/pages/accounting/reports/index.tsx:5,32,47–68` | 三种报表复用 QueryErrorState；读取中显示状态，失败优先拦截，点击所属查询 refetch。利润表/现金流存在同一缺失状态分支，一并处理 |
| `frontend/src/pages/accounting/consolidation/index.tsx:7,53–71` | 保留原查询并读取其完整状态；queryKey、queryFn、enabled 逐项未变 |
| 同文件 `125–127` | 账套列表失败不再永久显示加载，使用共享错误区和独立重试 |
| 同文件 `141–169` | 资产负债表、利润表分别处理错误/读取/成功；正常侧继续显示真实结果；失败不展示缓存旧数或零报表 |
| `frontend/src/pages/accounting/report-read-state.test.tsx:1–184` | 新增 15 项实际页面、查询缓存及 API client 回归，仅 HTTP transport 使用合成响应 |
| `docs/frontend-pda-conventions.md` | 同步读取状态与重试约定，保留原财务/权限边界 |
| 总修复计划、上一批报告、本报告 | 更新这两处问题的完成状态，保留历史失败证据；其他批次不顺带宣称完成 |
| `docs/acceptance/2026-10-26-accounting-report-read-state/` | 19 张原始状态图、DOM/HTTP 读数、验证与清理证明，逐文件摘要见 manifest.json |

这是表现层状态处理：新增包装层只提供原卡片样式和 `role=alert/status`。没有新增组件接口、CSS 规则、颜色、深色模式改动或账务写入。重试期间替换为加载状态，避免保留旧金额和可重复点击的重试入口。

保留成功分支原有字段兼容值，但只有对应查询未失败、已结束读取且有 data 才呈现报表。第一次全量回归发现两项原有建账测试的成功夹具只提供部分字段；恢复原字段兼容方式后全量通过，没有修改原测试或放松断言。本轮未额外增加成功 DTO 的结构校验。

## 验证

Node 22.23.2。各命令的退出码见 [verification.json](acceptance/2026-10-26-accounting-report-read-state/verification.json)。

| 检查 | 实测结果 |
| --- | --- |
| 原实现运行首批 13 项回归 | 12 失败、1 通过；复现持续加载、错误时旧数/零值和无重试 |
| 修复后补齐的 15 项专项 | 15 通过 |
| 最终前端全量 `npm --prefix frontend run test:unit -- --maxWorkers=2` | 417 个文件、3790 项通过，退出 0 |
| `npm run lint`（frontend） | 退出 0 |
| `npx tsc -b tsconfig.app.json`（frontend） | 退出 0，使用实际应用项目 |
| `VITE_ELECTRON=1 npx vite build`（frontend） | 退出 0 |
| `npm run test:frontend-conventions` | 退出 0 |
| `npm run test:accounting` | 238 项通过 |
| `npm run test:agents-md-guard`、提交前 diff 检查 | 通过 |

新测试由现有 Vitest `src/**/*.test.{ts,tsx}` 与 `.github/workflows/test.yml:331` 的前端全量入口覆盖，无新增孤立脚本。[修前失败输出](acceptance/2026-10-26-accounting-report-read-state/red-before.txt)、[专项通过](acceptance/2026-10-26-accounting-report-read-state/focused-green.txt)、[最终全量摘要](acceptance/2026-10-26-accounting-report-read-state/frontend-all-summary.txt)分别留存；输出副本只去除行尾空白与末尾空行。负向错误边界测试会输出预期 stderr，不将其误判为用例失败。

专项覆盖三种单体报表的首读失败/原条件重试、缓存后 403 失败隐藏旧数、重试进行中、账套/期间切换后的查询身份、单体成功零值，以及合并两表独立失败/缓存错误/加载/恢复、账套列表失败重试和成功零值。旧实现会失败，未只添加“总是通过”的实现镜像测试。

## 浏览器与独立库证据

临时 Vite `127.0.0.1:5173` 和 API `127.0.0.1:59821` 从本工作树加载。使用本批新建的 MySQL 容器/卷、回环 32784、独立 `flowcube_accounting_report_test`；按既有正式空库入口初始化。夹具由原 service 建立三个合成账套、8 张凭证和 16 条分录；没有使用真实客户/账款或共享开发库。

浏览器使用真实登录/活动会话、真实前端及后端。只有私有验收包装器按端点注入 HTTP 503 或 1800ms 延迟，用于稳定复现；成功请求仍由实际 API/数据库处理。以下均为真实点击“重试”，不是重载页面代替重试。

| 页面与状态 | 改前 / 改后证据 |
| --- | --- |
| 单体资产负债表失败 | [改前持续加载](acceptance/2026-10-26-accounting-report-correctness/single-error.png) → [明确错误与重试](acceptance/2026-10-26-accounting-report-read-state/single-error.png) |
| 单体点击重试 | [读取中](acceptance/2026-10-26-accounting-report-read-state/single-retry-loading.png) → [恢复资产 90、折旧 −10](acceptance/2026-10-26-accounting-report-read-state/single-recovered.png) |
| 单体切换期间后失败/重试 | [202611 失败](acceptance/2026-10-26-accounting-report-read-state/single-period-error.png) → [仍为 202611、资产 140](acceptance/2026-10-26-accounting-report-read-state/single-period-recovered.png) |
| 同页利润表 | [失败](acceptance/2026-10-26-accounting-report-read-state/single-income-error.png) → [重试恢复](acceptance/2026-10-26-accounting-report-read-state/single-income-recovered.png) |
| 同页现金流量表 | [失败](acceptance/2026-10-26-accounting-report-read-state/single-cashflow-error.png) → [重试恢复](acceptance/2026-10-26-accounting-report-read-state/single-cashflow-recovered.png) |
| 合并资产负债表失败 | [改前零值和“不平”](acceptance/2026-10-26-accounting-report-correctness/group-error.png) → [资产侧错误，利润侧真实 −30](acceptance/2026-10-26-accounting-report-read-state/group-balance-error.png) |
| 合并资产侧重试 | [资产侧加载，利润侧可读](acceptance/2026-10-26-accounting-report-read-state/group-balance-retry-loading.png) → [资产 270、折旧 −30](acceptance/2026-10-26-accounting-report-read-state/group-balance-recovered.png) |
| 合并利润表失败/重试 | [利润侧失败，资产侧真实 320](acceptance/2026-10-26-accounting-report-read-state/group-income-error.png) → [独立加载](acceptance/2026-10-26-accounting-report-read-state/group-income-retry-loading.png) → [202611 利润真实为 0](acceptance/2026-10-26-accounting-report-read-state/group-income-recovered.png) |
| 账套列表 | [失败](acceptance/2026-10-26-accounting-report-read-state/company-list-error.png) → [重试恢复三条账套](acceptance/2026-10-26-accounting-report-read-state/company-list-recovered.png) |
| 成功空期 | 两页 202609 均显示真实 0=0：[单体](acceptance/2026-10-26-accounting-report-read-state/single-empty.png)、[合并](acceptance/2026-10-26-accounting-report-read-state/group-empty.png) |

改前截图来自本分支父提交 61d598c 的同日独立库走查，明确作为历史对照；改后截图为本轮实际页面。DOM 的错误区、加载区、期间、表格文本见 [browser-observations.json](acceptance/2026-10-26-accounting-report-read-state/browser-observations.json)。

HTTP 留证验证六组“503、503、点击重试后 200”序列（前两次含原自动重试），重试的 URL/期间/账套头不变。资产侧重试未重新请求利润表，利润侧重试未重新请求资产表；刷新时出现的 304 是正常缓存校验。详见 [http-observations.json](acceptance/2026-10-26-accounting-report-read-state/http-observations.json)。没有修改默认自动重试次数。

浏览器后以真实鉴权 API 再次核对单体/子账套/汇总/空期/未来期五个金额，全部通过。8 张凭证和 16 条分录哈希未变；资金流水夹具为 **0 条**，只证明本轮没有新增资金流水，未外推非空存量。见 [api-results.json](acceptance/2026-10-26-accounting-report-read-state/api-results.json)。

## 收尾与边界

自有浏览器会话已关闭且回读列表为空；本批 API、Vite、MySQL runner 均退出，归属容器/卷已精确删除，原有 5197 服务仍监听。见 [resource-cleanup.json](acceptance/2026-10-26-accounting-report-read-state/resource-cleanup.json)。凭据/票据只在本机私有临时目录，不进入交付。

本轮已完成这两处失败态；没有将批次 B 的全部能力校准或 C/D 政策任务标为完成。未覆盖真实历史/生产账套、全权限角色、离线/重连、成功响应 DTO 缺损校验、大数据量、业务写入 GUI、部署、PDA 与实际出纸。未推送，故没有本提交的远端 CI 结论。
