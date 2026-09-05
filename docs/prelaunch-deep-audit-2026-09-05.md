# v0.9.6 上线前多维度深度审计

> 修复状态（2026-09-05）：F01–F17 已在本地代码完成修复及回归，含复核新增的同类问题；详见 [修复交付](prelaunch-fixes-2026-09-05.md)。下文与原始 JSON 保留修复前证据，不能作为当前实现或已部署状态。

日期：2026-09-05（北京时间）
代码基线：`16d6435f7ca7d64db9641ede82df4c2b76c5c7b1`，`main`，三端版本 `0.9.6`。开始扫描时工作区干净。
状态：**审计发现，尚未修复。建议暂缓以此代码基线直接扩大生产使用。** 本报告不是生产数据审计或上线批准。

## 1. 结论与范围

本次归纳 **17 组问题：9 组 P1、8 组 P2**。其中资金余额并发错误、账户删除竞态、固定资产账证不一致、跨仓读写、账套缓存串用已通过真实服务 / HTTP / 浏览器复现。依赖漏洞区分了“版本落入公告范围”和“应用攻击链已证实”；没有声称发现可直接利用的远程代码执行。

P1 表示建议上线前解决的资金、权限、账套或发布安全风险；P2 表示影响业务正确性、可靠性或运维预期的问题。严重度是项目修复优先级，不等同于 CVSS。另列 5 项优化方向及死代码判断，均未自动删除或改写业务代码。

扫描维度包括：库存与预占、事务并发、财务与会计、权限与仓库范围、认证及客户端边界、导出完整性、日期与状态契约、前端缓存与页面、依赖安全、部署与监控、性能、未使用代码和测试覆盖。

| 代码范围 | 规模 / 方法 | 验证边界 |
|---|---|---|
| 后端 `backend/src` | 302 个 JS 文件，48,633 行；路由 / SQL / 状态 / 权限模式扫描，重点服务完整调用链复核 | 重点深读资金、资产、库存引擎、销售 / 采购、退货、门户、导出、HR 等；不宣称每一行都经人工证明 |
| 前端 `frontend/src` | 492 个 TS/TSX 文件，66,749 行；类型、lint、引用图、API 契约与路由扫描 | 本地开发模式验证登录、固定资产、账套切换；未逐个验收全部页面状态 |
| 桌面与脚本 | 桌面 4 个 JS 文件；发布 / 运维脚本及工作流 | 静态检查、相关回归；未执行正式发布 |
| 数据库 | 233 份 SQL 迁移在全新 MySQL 8.0.46 执行 | 专用隔离库；没有检查或修改生产历史数据 |

机器证据见 [审计证据 JSON](prelaunch-deep-audit-evidence-2026-09-05.json)。页面证据见 [账套切换后旧资产仍可见](audit-evidence-2026-09-05/assets-after-switch.png)。所有演示数据均为本次隔离测试数据。

## 2. P1：建议上线前处理

### F01 资金余额在并发入账后少计

- 位置：`backend/src/modules/finance/finance-accounts.service.js:69–79`、`backend/src/modules/payments/payment-receipts.service.js:249–260`、`backend/src/utils/codeGenerator.js:58`。
- 触发：同一账户两笔收款并发；后启动的事务先通过单号前缀查询建立一致性快照，再等待另一笔收款提交。
- 实测：10 元、20 元两笔收款均成功，流水合计 **30.0000**，`current_balance` 却为 **20.0000**。证据：`receipt_concurrent_balance`。
- 原因：账户行虽有 `FOR UPDATE`，余额聚合仍是普通一致性读，能读到该事务较早的快照。锁住账户行并不自动把后续普通 SUM 变成当前读。
- 影响：账户余额及流水 `balance_after` 不可信，影响资金报表及后续决策。
- 修复方向：统一账户锁顺序与读取语义，让事实流水聚合读取当前已提交状态；不要只在某个控制器补锁。覆盖收款、付款、核销、报销、调整等所有调用方。
- 验收：两个独立事务按上述顺序交错，余额始终等于期初加净流水；补读写反向、取消和冲销场景。

### F02 删除账户与新增流水存在检查后竞争

- 位置：`backend/src/modules/finance/finance-accounts.service.js:248–258`。
- 实测：删除流程查得流水数为 0 后暂停；另一笔 30 元收款提交；继续删除，仍返回成功。最终账户已软删除，但有 1 条流水且余额为 30 元。证据：`account_delete_race`。
- 原因：计数检查和软删除不在一个持有账户行锁的事务内，未与 `recordTransaction()` 共用互斥边界。
- 影响：存在资金事实的账户从常规列表消失，后续处理难以追踪。
- 修复方向：删除与资金写入以同一账户行锁串行化，在锁内复查流水；保留历史事实，拒绝不满足条件的删除。

### F03 固定资产末期折旧台账与凭证金额不同

- 位置：`backend/src/modules/fixed-assets/fixed-assets.service.js:174–218`。
- 实测：原值 100、残值率 0、使用 6 个月。前五期各 16.67，末期台账为 **16.65**，凭证仍为 **16.67**；台账累计 100，凭证折旧累计 100.02。证据：`asset_rounding`。
- 原因：台账采用封顶后的 `actualMonthly`，凭证分录及返回值仍采用常规 `monthly`。
- 修复方向：台账、凭证、响应统一使用实际本期金额，并检查已存在数据的差额。历史凭证纠正须遵循红字修订和期间规则，不直接改账。

### F04 处置资产时补提当月折旧，没有生成对应折旧凭证

- 位置：`backend/src/modules/fixed-assets/fixed-assets.service.js:263–273`、处置凭证生成段。
- 实测：新建原值 1,200、残值率 5%、使用 12 个月的资产，未先计提就处置。新增折旧台账 **95 元**，对应 `asset_depreciation` 凭证为空。证据：`asset_dispose_missing_voucher`。
- 影响：处置按扣过折旧的净值计算，但总账缺少该期折旧费用和累计折旧来源，资产台账与总账不能勾稽。
- 修复方向：把补提台账和折旧凭证生成封装为同一事务内的公共动作，再生成处置凭证；覆盖当期已经提过折旧的幂等路径。

### F05 塑料盒接口缺少仓库范围和库位归属校验

- 位置：`backend/src/modules/plastic-boxes/plastic-boxes.controller.js:4–18`、`plastic-boxes.service.js:6–103`。
- 实测：账号仅有仓库 1 的范围及相应库存功能权限，却能在仓库 3 创建塑料盒（201）、查看（200）、删除（200）；同时接受了属于仓库 1 的库位。证据：`plastic_box_scope`。
- 原因：控制器未传用户仓库范围，服务不校验目标仓、盒子所属仓和库位所属仓；前端选项过滤不能代替后端校验。
- 影响：跨仓读写和错误位置归属。创建的是零数量空盒，本次没有制造库存，不应误报为“任意加库存”。
- 修复方向：列表、详情、流水、创建、删除统一接入范围校验；创建验证启用商品 / 仓库 / 库位及归属；删除补事务与状态复查。塑料盒和库位等导出入口同时复查范围传递。

### F06 供应商采购门户绕过常规采购列表的仓库限制

- 位置：`backend/src/modules/portal/portal.controller.js`、`portal.service.js:39`。
- 实测：受限账号访问 `/api/purchase` 得到空列表，但访问 `/api/portal/purchase-status?supplierId=1` 得到范围外 `AUDIT-PO`。两接口均为 200。证据：`portal_warehouse_scope`。
- 原因：门户查询只按供应商过滤，没有接入用户仓库范围。
- 修复方向：与常规采购查询使用一致的范围条件，测试同供应商多仓、多明细及无权账号。
- 边界：这是内部已登录用户的仓库越权；当前门户不是外部客户独立登录系统，不扩张为“外部访客任意泄露”。

### F07 切换账套后旧查询缓存仍显示，后续请求却使用新账套

- 位置：`frontend/src/store/companyStore.ts:19`、`frontend/src/hooks/useVouchers.ts:12`、`frontend/src/pages/fixed-assets/index.tsx:156`、`frontend/src/lib/queryClient.ts:14`。
- 浏览器实测：先打开账套 1 固定资产；在“合并报表 / 账套”点击账套 2 的“切换”；返回固定资产，仍显示 `Audit rounding` 等旧资产。此时 store 的 `companyId=2`，同页面通过实际 API 客户端查询只返回“乙账套专属设备”。证据：`company_cache_switch` 及截图。
- 原因：部分账套页面的 query key 不含 `companyId`，切换只改 store，未清理 / 重取相关缓存；全局缓存新鲜期 5 分钟、窗口聚焦不重取。
- 影响：显示内容与操作目标不一致。尤其“计提本月折旧”等批量操作可能作用于新账套，而用户看到旧账套。
- 修复方向：账套维度进入全部相关 query key；切换处理在途请求、选中项和编辑弹窗；页面明确展示当前账套。不能只刷新一个页面。

### F08 导出请求丢失当前账套，默认导出主账套

- 位置：`frontend/src/lib/exportDownload.ts:14–16`、`frontend/src/pages/fixed-assets/index.tsx:195`、`backend/src/modules/export/export.service.js:824–829,1471,1497`。
- 实测：账套 2 存在专属资产，固定资产导出默认返回账套 1 的三条资产；显式调用服务传 `companyId=2` 才返回正确资产。证据：`export_company_date_status`。
- 原因有两层：下载 fetch 只有 Authorization，没有 `X-Company-Id`；通用导出路由未统一应用账套中间件，部分服务直接默认 1，会计期间导出甚至不接收账套参数。只修前端请求头不足以全部解决。
- 影响：资产、会计期间、税务调整及使用该下载通道的凭证导出可能与屏幕账套不一致。
- 修复方向：统一二进制下载的认证、续期、账套和超时契约；服务端显式传递校验后的账套；用两个不同数据的账套验证列表、导出和操作一致。

### F09 桌面运行时已过旧，现有安全门禁却会跳过它

- 位置：`desktop/package.json`、`desktop/package-lock.json`、`.github/workflows/security-scan.yml` 的 `npm audit --omit=dev`、`desktop/preload.js:31–59`。
- 当前锁定 Electron **33.4.11**。Electron 虽声明在 devDependencies，实际作为桌面程序运行时分发，不能按普通开发辅助包忽略。
- 本次三端 `npm audit --omit=dev` 均为 0；完整扫描桌面得到 22 个受影响包条目（20 high、1 critical、1 low），前端 3、后端 1。**这些是依赖包条目，包含构建工具和传递依赖，不是 22 条已证实的桌面攻击链。**
- 官方公告 [GHSA-h7rp-cf8h-j98x](https://github.com/electron/electron/security/advisories/GHSA-h7rp-cf8h-j98x) 将低于 39.8.9 的版本列入范围；其条件包括向不可信内容通过 contextBridge 暴露返回 Promise 的函数。项目 preload 有此类 invoke 包装，但本次没有证明不可信内容能进入相关窗口，也未执行漏洞利用。公告列出的修复分支包括 39.8.9、40.9.2、41.2.2；版本选择还须遵循当前支持周期。
- Electron 官方只支持最新三个稳定主版本，见 [支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)。应升级至仍受支持且修复相关公告的版本，验证 Windows 启动、打印、更新与下载；门禁单独检查实际分发运行时。不要直接 `npm audit fix --force` 跨多个大版本。

## 3. P2：业务正确性、可靠性与运维

### F10 重复计提同一期间，累计折旧字段发生变化

- 位置：`fixed-assets.service.js:174–200`。
- 实测：同资产同期间重复计提，本期金额仍 16.67，但累计字段由 **16.67 变为 33.34**。证据：`asset_repeat`。
- 原因：汇总包含本期已有台账，随后再加一次本期金额覆盖原记录；唯一键只避免多行，不能保证计算幂等。
- 修复：明确已计提期间重试和重新核算语义，排除本期或返回既有回执；覆盖历史期间重跑、末期和处置期，检查后续累计值。

### F11 已提足资产无法正常完成处置

- 位置：`fixed-assets.service.js:233–273`、`frontend/src/pages/fixed-assets/index.tsx:182`。
- 实测：原值 100、累计折旧 100 的资产次月处置，服务仍追加 16.67 当月折旧，最终报 `ACCT_VOUCHER_UNBALANCED`：借 133.34 ≠ 贷 116.67，事务回滚。证据：`asset_full_dispose`。
- 页面同时仅对状态 1 显示处置按钮，状态 2“已提足”没有处置入口。
- 修复：已提足仍允许合法处置；折旧以剩余可折旧金额为上限。验证残值率为零和非零两类资产。

### F12 客户门户按名称模糊匹配，混入其他客户对账单

- 位置：`backend/src/modules/portal/portal.service.js:16–28`、`backend/src/modules/payments/reconciliation-statements.service.js:235–236`。
- 实测：指定客户“审计甲”，返回“审计甲”和“审计甲乙”两家的对账单。证据：`portal_customer_filter`。
- 原因：ID 先转客户名称，然后传给公共列表 `partyName LIKE '%…%'`。
- 修复：使用明确客户关联键；若旧表只有名称快照，需制定兼容映射，不能把等值名称当永久唯一 ID。增加同名、包含关系、客户改名测试。

### F13 多处“导出”静默截断为最多 500 条

- 位置：`backend/src/modules/export/export.service.js:774–1527` 中 16 处 `pageSize: 500`。
- 实测：503 个客户，导出仅 500 行，没有截断提示。证据：`export_truncation`。
- 涉及：运单、固定资产、报销、处置、授信申请、拣货波次、用户、操作日志、承运商、塑料盒、库位、货架、分拣筐、供应商、客户、账套等入口。具体每类还应按各自服务验证排序与筛选。
- 原因：列表统一上限 500，导出只取第一页且忽略分页 total；后置大导出上限检查看不到未读取的行。
- 修复：专用有明确上限的导出查询，或稳定排序的分批读取；超限明确提示。不把公共列表上限调成无限大。资金流水已有专用上限查询，不应退回列表第一页实现。

### F14 固定资产日期与状态展示 / 导出契约错误

- 位置：`fixed-assets.service.js:29`、`frontend/src/pages/fixed-assets/index.tsx:172`、`export.service.js:833–847`。
- 实测：北京时间 2026-09-01 的购置日期，页面直接显示 `2026-08-31T16:00:00.000Z` 并折成多行；导出显示 `Tue Sep 01`，年份丢失。已提足状态 2 导出成“已处置”，真正处置状态 3 导出“—”。证据：`export_company_date_status` 及截图。
- 修复：API DATE 字段保持北京业务日期语义，复用日期工具；页面与导出共用资产状态映射。不要用 String(Date).slice 或直接截 UTC 日期。

### F15 默认前端错误上报因无认证返回 401，后端 Sentry 也缺依赖

- 位置：`frontend/src/components/GlobalErrorBoundary.tsx:58–71`、`backend/src/modules/system/system.routes.js:29–36`、`backend/src/middleware/errorHandler.js:76–88`。
- 实测：与错误边界同样不带 token 的上报为 401，带有效 token 为 200。证据：`error_reporting_auth`。
- 错误边界只提供 Content-Type，并吞掉失败；URL 还直接拼构建变量，未复用运行时服务器地址。此结论针对未配置前端 Sentry 的备用通道。
- 后端 `SENTRY_DSN` 分支动态 require `@sentry/node`，但 backend/package.json 未声明；干净安装后启用该配置仍会进入失败告警分支。前端已声明 `@sentry/react`，两者不要混淆。
- 修复：恢复具有认证和运行时地址的上报通道，明确登录前错误的受限收集策略；若正式支持后端 Sentry，则声明依赖并补一次真实投递验证。不要简单开放无界限匿名日志写入。

### F16 HR 工资 API 尚未形成可用业务闭环

- 位置：`backend/src/modules/hr/hr.service.js:85–110,141–164,187–246`、`hr.routes.js`；`backend/src/app.js:115` 已注册该模块。
- 实测：新员工建工资单 → 核算 → 发放可成功，工资总额及实发额均为 0，最终状态为 3。证据：`zero_payroll`。
- 原因：创建明细不提供实际工资来源，核算依赖 `detail_json.gross`，但现有路由没有工资明细维护入口，前端也未发现 HR 工资页面。
- 判断：这是已暴露的未完成业务链，不是能直接删除的死代码。个税纯函数通过不代表工资发放流程完整。
- 修复：明确本次上线是否启用此模块；启用则补录入 / 导入、审核及非零业务验证，不启用则通过明确产品与权限策略隔离。不要因为零工资场景存在就一概禁止所有合法零值工资。

### F17 Compose 覆盖文件和环境变量传递与运维说明不一致

- 位置：`docker-compose.prod.yml:9–12,39–44`、`docker-compose.yml` 后端 environment、`backend/src/config/env.js:58–63,82`、`docs/runbooks/key-rotation.md`。
- 用虚构配置执行 `docker compose --env-file … -f docker-compose.yml -f docker-compose.prod.yml config --format json`，仅解析，没有启动这些服务。结果：MySQL 仍映射 `127.0.0.1:3306`，`ports: []` 没有清掉基础列表；前端同时保留 `127.0.0.1:8080` 和新增 `0.0.0.0:80`。
- 因此“禁止暴露 MySQL 端口到宿主机”的注释不成立，但 MySQL 仍仅回环监听，**不是公网裸露**。新增 80 端口可能和宿主反代冲突。
- 此外 Compose 明确传入旧的 `JWT_EXPIRES_IN`，未传应用读取的 `JWT_ACCESS_EXPIRES_IN`、`JWT_REFRESH_EXPIRES_IN`、`JWT_SECRET_PREVIOUS`、`DB_POOL_SIZE`。仅修改根 `.env` 不会让未声明变量自动进入容器，密钥轮换的旧 token 兼容步骤可能不生效。
- `scripts/server-update.sh` 当前调用基础 Compose，未显式加载 prod 覆盖文件。因此端口问题是备用部署路径缺陷，**未据此判断当前生产端口已出错**。
- 修复：统一实际部署入口、环境清单和说明；用明确覆盖 / 重置语义，并对解析后的端口与关键环境键添加契约检查。

## 4. 性能与维护优化

| 编号 | 发现与证据 | 建议 / 优先级 |
|---|---|---|
| O01 | `codeGenerator.js:145–173` 每次生成容器码都执行历史条码 MAX 初始化查询；连续生成 3 次，聚合查询也执行 3 次，即使序列表已存在。证据 `container_code_scan` | 先尝试序列正常递增，仅初始化时扫描旧值；保持唯一键和并发重试。没有做生产规模压测，不虚构耗时倍数。P2 |
| O02 | PDA Web 构建仍产出完整 ERP 相关路由和现代 / legacy 两套资源：本次 511 个文件、约 7.37 MB；ERP 258 个、约 2.88 MB，均为未压缩磁盘总量 | 评估按端构建路由表、按实际 Android WebView 支持范围保留兼容包。这不是首屏下载量，不能直接推导启动慢。P3 |
| O03 | `sale.service.js` 1,853 行、`export.service.js` 1,594 行、`containerEngine.js` 1,288 行；前端打印模板编辑器 2,382 行 | 以事务责任和业务行为拆分窄模块，先补边界测试再抽取；不要在发版前纯为行数大范围重构。P3 |
| O04 | query key、导出、错误上报分别实现身份 / 账套 / 服务器地址，已形成 F07/F08/F15 的契约分叉 | 把账套查询和文件下载纳入统一客户端，保留业务权限与错误语义。随对应缺陷一起处理 |
| O05 | 现有 26 套回归通过，但仍未覆盖本次资金快照、资产末期 / 重试 / 处置、门户替代入口、账套切换及 500 条导出 | 优先新增这些能真实失败的交错和端到端测试；独立库或完整 fixture reset，避免测试间残留影响结果。P2 |

桌面进一步加固可检查导航允许列表、新窗口处理和 IPC 调用来源；当前主窗口启用了 contextIsolation、关闭 nodeIntegration，这些已有保护应保留。未证实的攻击条件不作为额外漏洞计数。

## 5. 死代码与残留：能清理什么，不能直接删什么

使用 Knip 6.34.0 扫描前后端，再以仓库引用搜索复核。Knip 临时安装在 npm 缓存，没有修改项目依赖和 lockfile。

| 项目 | 本次判断 | 后续动作 |
|---|---|---|
| `frontend/src/components/ui/card.tsx` | 未找到运行代码引用，Knip 也标记整个文件未使用 | 可作为独立清理候选；当前主要使用 SectionCard 等组件 |
| `frontend/src/pages/carriers/utils.ts` 的 `getNextCarrierCode` | 未找到调用，属于旧承运商取码辅助实现 | 可作为独立清理候选；删除前重跑类型及承运商页面检查 |
| `frontend/scripts/generate-icons.cjs` | 手动图标生成器，未进 package script；未被应用 import 不代表无用途 | 确认品牌资源生成是否还需要，再接入命令或归档；不自动删除 |
| `backend/scripts/schema-reconcile.js` | Knip 从 backend 项目视角报未用，但根目录 `npm run check:schema` 明确引用 | **误报，保留** |
| `@capacitor/splash-screen` / `@capacitor/status-bar` | TS 无直接引用，但 Android Gradle 工程引用插件 | **不能根据 JS 引用图删除**，需原生验收 |
| generated/status、测试使用的工具导出、公共类型 | 未使用 export 提示不等于文件死亡；部分用于契约与测试 | 可收窄不必要 export；不手改生成常量，不批量删除类型 |
| `voucherSource.js` 顶部“尚未接入凭证生成”注释 | 已有会计、资产、HR 多处实际引用 | 是过时注释，**不是死代码**；后续同步正文说明 |
| 废弃接口 410 响应、历史迁移、旧静态下载兼容 | 显式兼容 / 防误用机制，不能因“废弃”文字判断无用 | 保留；移除须单独确认消费者和兼容期 |
| HR | 见 F16，API 已挂载 | 未完成能力应补齐或明确隔离，不当作无引用模块删除 |

没有基于扫描器输出进行批量删除，也没有将“未使用 export 数量”充当可安全删除代码量。

## 6. 本次实际验证

运行环境：项目 Node 22.23.2；新建 `flowcube-audit-20260905` MySQL 8.0.46 容器，监听回环 13308，测试配置权限 600。专用库 `flowcube_audit_test`、`flowcube_audit_integration_test`、`flowcube_probe_test`。测试均通过公共环境校验，不加载真实 backend/.env。

| 检查 | 此次结果 |
|---|---|
| 后端 lint / 前端 lint / `tsc -p frontend/tsconfig.app.json --noEmit` | 通过；前端 5 个 react-refresh warning，0 error |
| 前端 Vitest | 19 文件、92 测试通过 |
| 部署、工具、桌面、PDA 发布、CORS、状态契约、销售契约及商品查找 Node 测试 | 最终完整重跑 104 / 104 通过 |
| 26 套业务 / 领域回归 | 26 套命令退出 0，清单在证据 JSON |
| 集成测试 | 在专用新库运行，96 通过，0 失败 |
| 标签、打印、权限、会计、日志脱敏命令 | 全部退出 0；各脚本内部计数保留在临时运行日志 |
| ERP / PDA Web 构建 | 均通过；输出到临时目录，不覆盖工作区 dist |
| 全量 / 生产依赖 npm audit | 全量：后端 1、前端 3、桌面 22；omit=dev 三端均 0；差异见 F09 |
| Gitleaks 当前 HEAD 导出快照 | 扫描约 8.35 MB 文本，未发现命中；没有据此声称全部 Git 历史或个人配置无凭据 |
| ShellCheck | 仅动态 source 的 SC1090 提示；不认定为运行缺陷 |
| 浏览器 | 隔离后端 13009 + Vite 15173，本地开发模式登录并验证资产和账套；复现缓存和日期问题 |
| 自定义探针 | 真实 MySQL、真实服务 / HTTP；并发只用等待钩子控制时序，没有替换业务查询结果 |

26 套回归覆盖 audit-inventory、audit-finance-security、mainline、concurrency-guards、sale-adjustment、sale-atp、p0 / p1、warehouse-scope、pda-device-session、finance、disposal、invoice-quota、refund-orders、accounting、accounting-period、print-jobs-purge、search-scope、users-roles、reports-values、credit-outbound、purchase-approval、approval-flow、credit-override、dashboard-sales-v2、hr-tax。最后一项含纯函数验证，不把 26 套都说成全流程数据库验收。

运行中异常也保留边界：首次空库探测在迁移前因缺表失败，执行全部迁移后相关回归通过；集成测试首次复用其他套件运行后的库，受残留客户额度影响出现 4 项失败，换全新专用库后 96 项通过；首次并行构建时的超时工具测试因启动时间窗口失败，单项及整组重跑均通过。这些不计入已确认业务缺陷，但体现测试隔离与时序稳定性仍可改进。

## 7. 处理顺序和剩余边界

1. 先处理 F01/F02 资金并发和 F05/F06 权限；增加真实交错 / 受限用户回归。
2. 处理 F03/F04/F10/F11/F14 资产核算，统一实际金额、幂等、处置和显示契约，再做台账—凭证—总账勾稽。
3. 统一 F07/F08/F12/F13 的账套、客户身份与导出数据集，做双账套、相似客户名和超过 500 条的页面 / 下载验证。
4. 处理 Electron 运行时与门禁、错误监控、Compose 配置；确认 HR 上线范围。
5. 最后做低风险死代码清理和性能改进，逐项保留回归证据。

未验证：当前生产数据库是否已有相关脏数据；生产实际环境变量、慢查询、容量、备份恢复；Windows 安装 / 自动更新；Android 真机扫码、设备会话和物理打印；真实物流、短信等第三方链路；全部页面在所有角色、屏幕尺寸、空态 / 错态下的表现。不能用本次构建或测试通过替代这些验证。

以上是原始审计时点的记录。后续本地修复已完成，逐项状态及验证见开头的修复交付链接；原始证据 JSON 保留。尚未提交、推送或发布。
