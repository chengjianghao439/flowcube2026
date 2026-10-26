# 资产负债表抵减资产修复：批次 A

2026-10-26。单体与账套汇总的资产方向已修复：固定资产原值 100、累计折旧 10，资产合计从错误的 110 改为 90。回归、独立库、真实 API 及页面金额核对通过；走查发现的两处既有页面失败态仍未修复，不将整页验收称为通过。

## 基线和范围

- 分支：`codex/accounting-report-correctness`，从当场核对的 `origin/main` / 本地 `main` `54cef45522212f37c9a7fb1152d66e7fce7513ec`（v0.13.8）建立独立工作树。
- 样式分支 `codex/desktop-ibm-style` 保持 `2b8a949cf8f83be31a6b7372531542a3701133f2`，原有两份未跟踪计划保留；没有将样式分支提交带入财务修复。
- 本批只修两个只读报表的资产金额。SQL、接口、科目正常方向、负债/权益/损益分支与 balanced 的真实比较保持原样；无前端/TSX、产品迁移、凭证生成、资金/库存写入、权限、PDA、打印改动。
- 本地提交交付，完整提交号见交付回复或本文件所属提交。未推送、未合并、未打 tag、未发布。批次 B/C/D 仍待各自处理。

## 改动文件与原因

| 文件与位置 | 改动 |
| --- | --- |
| `backend/src/modules/accounting/accounting.ledger.service.js:278–282` | 资产分支按借方累计减贷方累计列报，抵减项目保留负号 |
| `backend/src/modules/accounting/consolidation.service.js:68–72` | 汇总资产采用同一方向，保留原账套范围与汇总方法 |
| `tests/accounting-statement-balances.test.js:1–89` | 实际 service 的 17 项离线回归；仅替换数据库边界；提供 VM 反向验证 |
| `package.json:96` | 新测试追加到既有 `test:accounting`；CI 已在 `.github/workflows/test.yml:616` 调用它 |
| `docs/finance-permission-time.md:576–580` | 同步列报符号、balanced 含义及证据边界 |
| `docs/superpowers/plans/2026-10-26-accounting-contra-asset-fix.md` | 更新批次 A 清单与实测状态；澄清只允许初始化本批独立空库 |
| `docs/superpowers/plans/2026-10-26-finance-accounting-remediation.md` | 标明 A 执行状态，将新发现的失败态登记到 B |
| 本报告与 `docs/acceptance/2026-10-26-accounting-report-correctness/` | 保存合成数据结果、红绿/反向验证、原始截图、页面读数和资源清理证明；逐文件摘要见 `manifest.json` |

没有通过科目编码特判、截零、修改 balanced 或倒算权益来平账。历史异常的负净额仍可见；离线负净额样例不表示允许新增超额折旧业务。

## 回归与反向验证

运行环境为 Node 22.23.2。命令、退出码和数量见 [verification.json](acceptance/2026-10-26-accounting-report-correctness/verification.json)。

| 检查 | 实际结果 |
| --- | --- |
| 原有 `npm run test:accounting` 基线 | 221 通过，0 失败 |
| 新 17 项在原实现运行 | 10 通过，7 失败；实际 110、期望 90 等反例成立 |
| 修正后新回归 | 17 通过，0 失败 |
| `ACCOUNTING_REPORT_MUTANT=natural_asset` | 只在 VM 中恢复旧算法；退出 1、7 项失败，再次出现 110≠90 |
| 清除变异环境后的新回归 | 17 通过，0 失败 |
| 接线后的 `npm run test:accounting` | 238 通过，0 失败 |
| `npm --prefix backend run lint` | 退出 0，无错误 |
| `npm run test:agents-md-guard` | 退出 0 |
| `git diff --check` | 提交前检查通过 |

输出（仅去除行尾空白）：[修前红例](acceptance/2026-10-26-accounting-report-correctness/red.txt)、[修后绿例](acceptance/2026-10-26-accounting-report-correctness/green-final.txt)、[恢复旧算法的失败输出](acceptance/2026-10-26-accounting-report-correctness/mutant.txt)。覆盖单体/汇总、普通资产、累计折旧、负净额、资产贷方余额、分位金额、冲销净额、跨账套隔离和读取失败传播。未以 mock 结果替代下节真实数据库验收。

## 独立 MySQL 与真实 API

使用本批新建 MySQL 容器及具名卷，回环随机端口 32783，库名 `flowcube_accounting_report_test`。每次夹具写入前核对容器/卷批次标签、实际端口映射、存活 runner 和 `@@server_uuid`；未连接共享开发库或生产库。

空库通过现有 `backend/scripts/bootstrap-new-database.js` 完成初始化，包含正式新库角色默认值步骤及普通严格迁移。首次误用普通升级入口时被 296 的角色前置检查拒绝，已删除该次自有实例后重新建库；另一启动尝试因私有下载目录已存在退出，也已完成资源清理。未修改或跳过迁移、角色及权限守卫。

夹具通过现有建账、手工凭证及红冲 service 写入三个合成账套，共 8 张平衡凭证、16 条分录；这属于夹具准备，不是 GUI 业务录入验收。对同一库分别加载基线 service 和当前 service，只读比较：

| 条件 | 修前资产 | 修后资产 | 其他核对 |
| --- | --- | --- | --- |
| 主账套，202610：原值 100、累计折旧 10 | 110 | 90 | 抵减项 −10；负债 100、权益 −10，等式成立 |
| 子账套，202610：原值 200、累计折旧 20 | 220 | 180 | 抵减项 −20；未串入主账套 |
| 根账套及直接子账套，202610 | 330 | 270 | 抵减项 −30；负债 300、权益 −30 |
| 独立红冲对照账套 | 100 | 100 | 折旧与原红字冲销净额为零，账套不进入上述根汇总 |
| 主账套，空期 202609 | — | 0 | 没有资产条目 |
| 主账套，202611 | — | 140 | 未来新增原值 50；202610 仍为 90 |

[数据库原始结果](acceptance/2026-10-26-accounting-report-correctness/db-results.json)保留原始借贷合计、两算法返回值及哈希。8 张凭证和 16 条分录查询前后完全相同；浏览器验收后再次核对仍相同。资金流水样本为 **0 条**，校验只证明未新增流水，不能外推为非空资金存量回归。

通过真实 `/api/auth/login` 和活动会话登录管理员，随后 5 个鉴权 API 读数全部符合预期（主/子/汇总/空期/未来期），HTTP 均为 200。详见 [API 结果](acceptance/2026-10-26-accounting-report-correctness/api-results.json)。没有关闭鉴权或伪造接口金额。

## 浏览器核对

源码来自本修复工作树，临时前端 `127.0.0.1:5173`、后端 `127.0.0.1:53873`，均只连接上述合成库。使用一个命名会话、同一标签页和真实鼠标点击/输入；没有操作 5197 上的原有服务。

修前截图由私有验收包装器在内存中加载基线 `54cef455` 的两个报表方法，修后切换回当前方法；同一真实数据库、控制器、鉴权与前端渲染，未改仓库代码。切换算法后刷新页面，避免 React Query 旧缓存混入修后图。延迟与失败状态为验收包装器注入的 1800ms 延迟及 HTTP 503，明确不代表真实数据库故障。

| 页面/状态 | 实际结果与证据 |
| --- | --- |
| 单体修前/修后 | 110→90；累计折旧 +10→−10；不平→真实等式成立。[修前](acceptance/2026-10-26-accounting-report-correctness/single-before.png) / [修后](acceptance/2026-10-26-accounting-report-correctness/single-after.png) |
| 汇总修前/修后 | 330→270；累计折旧 +30→−30。[修前](acceptance/2026-10-26-accounting-report-correctness/group-before.png) / [修后](acceptance/2026-10-26-accounting-report-correctness/group-after.png) |
| 切换账套 | 点击子账套“切换”、确认离开，再打开会计报表；显示子账套 200−20=180。[截图](acceptance/2026-10-26-accounting-report-correctness/single-child.png) |
| 切换期间 | 输入 202611 后显示 150−10=140；回到 202610 为 90。[未来期](acceptance/2026-10-26-accounting-report-correctness/single-future.png) |
| 空期 | 两页 202609 显示 0；等式为 0=0。[单体](acceptance/2026-10-26-accounting-report-correctness/single-empty.png) / [汇总](acceptance/2026-10-26-accounting-report-correctness/group-empty.png) |
| 加载态 | 延迟注入期间单体显示“加载中…”，随后得到 140。[截图](acceptance/2026-10-26-accounting-report-correctness/single-loading.png) |
| 单体失败态，未通过 | 503 两次（含原重试）后仍显示“加载中…”，没有独立错误/重试界面；曾出现通用失败 toast。[截图](acceptance/2026-10-26-accounting-report-correctness/single-error.png) |
| 汇总失败态，未通过 | 503 两次后表内用 0/无数据和“不平”表示，另有失败 toast；不能视为成功的零报表。[截图](acceptance/2026-10-26-accounting-report-correctness/group-error.png) |
| 失败后的恢复 | 撤销故障注入，单体切走再切回该期间后成功取得 140；汇总刷新后恢复 270。没有声称点击过不存在的重试按钮。[单体恢复](acceptance/2026-10-26-accounting-report-correctness/single-recovered.png) |

实际 DOM 文本与表内读数见 [browser-observations.json](acceptance/2026-10-26-accounting-report-correctness/browser-observations.json)，报告请求/状态见 [http-observations.json](acceptance/2026-10-26-accounting-report-correctness/http-observations.json)。两处既有失败态已登记到批次 B；本批未扩展前端范围。

## 资源收尾、待验证与改判

任务浏览器已 close，回读会话列表为空；本批后端、Vite、MySQL runner 已退出，精确归属的容器与卷已删除。原有 5197 服务仍监听。见 [清理证明](acceptance/2026-10-26-accounting-report-correctness/resource-cleanup.json)。随机测试凭据与登录票据只留在本机私有临时目录，不在交付文件内。

- **已改判**：计划中的“不运行迁移”应明确为不对共享/生产库运行迁移；后续验收步骤本来要求在独立空库初始化既有结构。已澄清该句，无产品迁移变化。
- **未外推**：balanced 只证明会计等式；当前集团报表仍是根账套及直接子账套汇总，不宣称完成内部往来抵消或审计。
- **未覆盖**：真实历史/生产账套、非空资金流水存量、全角色与仓库范围、业务写入 GUI、闭期/补录完整链路、大数据量、PDA、实际出纸及部署验收。
- **待后续**：两处页面错误/重试呈现、批次 B 其他说明校准，以及需先定政策的 C/D；未借只读资产修复调整利润表、税务或结转口径。
- **待发版前验证**：全量数据库 smoke 与系统回归。前端无改动，本批未运行前端 tsc/构建；未将本地验证称为分支 CI 或线上通过。
