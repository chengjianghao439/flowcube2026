# Flowcube 功能扩展实施 · 交接词

> 用途：把这批功能扩展的实施工作交接给下一个会话（新的 Claude 实例或本人）。
> 接手第一件事：读 `docs/proposals/README.md`（12 份设计文档索引）+ 三条记忆 `erp-wms-feature-design-docs`（进度详情，最权威）、`user-hands-off-full-autonomy`（工作方式）、`release-dirty-worktree-technique`（发版精确 add）。

## 背景

为 flowcube（单租户 ERP/WMS，Node+Express+mysql2 无 ORM + React18+PDA）实施一批功能扩展。设计阶段已产出 12 份定稿设计文档在 `docs/proposals/`（01-12 + README 索引），现在处于**逐个实现**阶段。功能 10 会计总账已全部完成上线（v0.4.41/42）。

## 工作方式（用户明确要求）

- **全自主**：设计、执行、**验收**、**发版**全由你做，用户不做任何操作（不起服务、不登录、不点击、不发版）。用户 2026-08-02 明确「继续、按你理解发版、全部完毕再汇报」——**发版无需逐版确认**，按判断分版发布，攒到一个阶段完了再汇报。
- **验收自己做**：需要浏览器验收时优先复用**另一 chat 已在跑的 5173 前端**（已登录 admin），`navigate` 到 hash 路由 + `get_page_text`（比 screenshot 在共享面板争用下更稳）。核心逻辑用 `backend/scripts/xxx-tmp.js` 端到端脚本自验（`require('dotenv').config({ path: path.join(__dirname,'../.env') })`），跑完删除、造数据清理干净。
- **持续自主推进**，不频繁停；遇真正需拍板的业务决策或高危不可逆再停。

## 进度总览（截至 2026-08-04；上一会话发 v0.4.43→v0.4.47，接手会话发 v0.4.48→v0.4.55，全部上线）

**已全部发布上线生产**（三端同步、CI 全绿、生产 latest.json/app-update/pda 均验证到对应版本）：

| # | 功能 | 版本 |
|---|---|---|
| 01/02/05/06/08/09 | 安全库存/请购审批/信用额度/电子面单/循环盘点ABC/库龄呆滞 | v0.4.38 |
| 04 序列号 | Phase1 A–G（收货扫SN/上架/出库核销/台账追溯对账；灰度默认关） | v0.4.38/39 |
| 08增强/11单据化/03 P0+1/07 危险核心批 | ABC规则页 / 采购计划单据化 / 多单位主数据+只读展示 / 收货质检先检后入 | v0.4.40 |
| 10 会计总账 | Phase0 科目 + Phase1 凭证 + Phase2 总账报表 + Phase3 发票税务（全实现） | v0.4.41/42 |
| **07 Phase2 拒收处置** | 拒收品一键退供应商/报废（独立处置单·**零 GL**·消费 REJECTED 容器）+ 收货详情质检可视化 + voidReceipt 守卫；新权限 `inbound.qa.dispose`（迁移184/185） | **v0.4.43** |
| **04 Phase2 历史导入** | 有存量商品逐容器补齐 SN → 原子开 serial_managed；`serials/import`；商品档案开关守卫 | **v0.4.43** |
| **04 Phase3 逆向回冲** | 撤回收货/拒收处置/销售退货 支持序列号商品（`voidSerialsForContainers`/`returnSerials`/`moveSerialsOnSplit`）；PDA 销售退货扫SN；修 QA 边界拆分不搬 SN 潜伏 bug | **v0.4.44** |
| **07 Phase3 合格率报表** | 只读 `/reports/qa-quality` 按供应商聚合合格率 + 处置去向 | **v0.4.45** |
| **03 Phase2 采购按箱** | 采购按辅助单位(箱)录入；`utils/unitConversion.js` 折算权威；迁移186 + unit_price(18,8) | **v0.4.46** |
| **03 Phase3 销售按箱** | 销售建单/改单按箱录入（改单 fold-before-delta）；迁移187 | **v0.4.47** |
| **07 Phase3 让步接收统计** | 质检三桶（正常合格/让步/拒收）；`concession_qty` 旁路列（合格量子集，结算不变）；报表加让步列 + 严格合格率；迁移188 | **v0.4.48** |
| **03 Phase4a 退货按箱(ERP)** | 采购/销售退货明细加 entry 三列（迁移189）；无源手工退货可按箱录入（源单绑定时锁死不变）；退货冲减恒按 quantity×unit_price 重算，零风险 | **v0.4.49** |
| **07 拒收处置 PDA 扫出** | 处置从 ERP 一步 void 改两阶段：ERP 决策生成处置单(待扫出) → PDA 逐个扫 REJECTED 容器码物理确认出场 void。迁移190 + 中间表；序列号回冲移到扫出时 | **v0.4.50** |
| **03 Phase4b PDA 收货按箱** | PDA 收货配辅助单位商品每箱预填箱规 + 显示"N箱(=M件)"，率系统给定不可改、只改件数（纯 UI 增强，无迁移，件数落库不变）。按箱录入只在收货有意义 | **v0.4.51** |
| **04 Phase3b-A 序列号容器拆分扫码** | `moveSerialsOnSplit` 加 serialNos（指定台，QA边界不传保持任取）；`splitContainer` 去 block 改为「序列号商品须扫要拆出的 SN」；PDA `/pda/split` 加逐台扫 SN 步。无迁移 | **v0.4.52** |
| **04 Phase3b-B+C（安全版）** | B：serial 改单 block 从「整体」收窄到「只挡已拣货减量」（增量/未拣减量放行）；C：serial 盘点差异抛错防静默破不变量。纯后端无迁移 | **v0.4.53** |
| **04 Phase3b-B-full** | 已拣货序列号减量的 PDA 物理归还扫码（confirmContainerReturn 扫要归还的台 + moveSerialsOnSplit 按名单迁移） | **v0.4.54** |
| **04 Phase3b-C-full** | 序列号商品逐台扫码盘点（PDA `/pda/stockcheck` 扫 SN，账面集 vs 现场集算 missing/surplus） | **v0.4.55** |
| **塑料盒/拆分机制补完** | 空壳塑料盒建不出来修复（createContainer 对 initialQty=0 放行）+ 拆分/并货双容器流水（MOVE_TYPE 12）+ 并货批次守卫（混批409/空盒继承批次效期）+ fmtSqlDate 时区错位修复 + 锁定拆分前置拦截 + plastic-boxes 流水接口 500 修复与详情弹窗 | **v0.4.56** |
| **13 Phase2 个体判定** | `isIndividualContainer`（type=1 且 initial=1）；个体不可拆分/并货（INDIVIDUAL_CONTAINER_NO_SPLIT）；库存页条码面板：单件徽标/仅看单件/流转时间线（`GET /inventory/containers/:id/logs`） | **v0.4.57** |
| **13 Phase3 链路去序列号化** | 收货/出库/拆分/改单/盘点五条链路删 serialEngine 全部调用与逐台扫码步；PDA serial 面板/盘点页删除；商品「序列号管理」开关删除；serial-consistency 冒烟随删；顺手修调拨建容器 toISOString 效期错位 | **v0.4.58** |
| **13 Phase4 删表清理** | 迁移192 删 product_serials/serial_events/inventory_check_item_serials + serial_managed 列 + 回收 serial.view/manage 权限；删 serialEngine/modules/serials/前端 serials 三页。**生产已验证三张表已删、权限已回收**（删前核查生产全为 0 行） | **v0.4.59** |

**设计文档 13《条码与序列号融合》已全量实施完毕**（2026-08-09 评审通过，当日四阶段全上线）。一物一码 = `container_type=1 且 initial_qty=1` 的库存容器，厂家机身码不再采集。
| **13 §4.3 PDA 扫码盘点** | 盘点扫容器码：个体扫到计 1、数量容器预填账面数可改；提交按容器精确对账（未扫=整只盘亏精确扣，不走 FIFO；实盘>账面拒收——盘盈走 ERP）；`inventory_check_item_containers`（迁移193）；PDA `/pda/stockcheck` + ERP 详情扫码行锁手填；整行替换幂等 + resolveServerState 兜底 | **v0.4.60** |
| **10 会计增强①+②** | ①多级科目汇总：试算平衡/科目余额表父级上卷行（如 2221=222101+222102）+ 明细账父级含下级；②期末结转与期间锁定（**用户 2026-08-09 拍板「本系统是正式账」**）：`acct_periods`（迁移194）+ 权限 `accounting.period.manage`；损益结转凭证（损益科目清零→4103 本年利润，12 月另 4103→4104 利润分配，UNIQUE(source_type,source_id) 幂等+hash 重算）；结账锁定凭证全部写路径（新建/删除/红冲/重算）；结账前置校验「结转凭证须最新」；期间页 /accounting/periods | **v0.4.61** |
剩余可选增强仅 `inventory_containers.external_code` 厂家码辅助查询列——已定案**不做**（用户 2026-08-09 决定），不再列入候选。

**04 序列号全部清完**（用户 2026-08-02 拍板："**AQL 抽样不做，其余都做**"；B-full/C-full 已随 v0.4.54/55 上线）：

| # | 功能 | 状态 |
|---|---|---|
| ~~03 Phase4a 退货按箱(ERP)~~ | ✅ v0.4.49 |
| ~~07 拒收处置 PDA 物理扫出~~ | ✅ v0.4.50 |
| ~~03 Phase4b PDA 收货按箱~~ | ✅ v0.4.51 |
| ~~04 Phase3b-A 容器拆分扫码指定台~~ | ✅ v0.4.52 |
| ~~04 Phase3b-B+C 序列号改单/盘点安全化~~ | ✅ v0.4.53 |
| ~~04 Phase3b-B-full 已拣货减量物理归还扫码~~ | ✅ v0.4.54 |
| ~~04 Phase3b-C-full 序列号逐台扫码盘点~~ | ✅ v0.4.55 |

**下一步**：12 份功能扩展文档（01-11）+ 文档 13 条码融合 + 会计增强①②已全部上线完结。剩余远期项仅业务单据内嵌价税（§4.5口径2，动核心链路金额口径，需单独立项拍板）。用户 2026-08-09 已定案：**用友导出模板不做**（保持通用/金蝶两档）、**厂家码列 external_code 不做**。

**已砍**：~~07 AQL 抽样检验~~（用户 2026-08-02 决定不做，省掉一个需业务定标准的大子系统）。~~用友导出模板~~（2026-08-09 决定不做）。~~external_code 厂家码列~~（2026-08-09 决定不做）。

**远期（暂不做）**：业务单据内嵌价税(§4.5口径2，动核心链路金额口径，需单独立项拍板)。~~会计多级科目汇总/跨期结转~~ 已随 v0.4.61 落地（跨期结转=期末损益结转+期间锁定）；~~用友导出模板~~、~~external_code 厂家码列~~ 用户 2026-08-09 定案不做。

- **当前迁移号到 194**（…、07拒收扫出=190、04C-full盘点SN=191、13P4删序列号体系=192、13§4.3扫码盘点=193、10会计期间结转=194）。新迁移取当前最大 +1（`ls backend/src/database/*.sql | sort | tail -1`），不写死。
- **全量回归基线**（v0.4.61 后）：mainline 49 / p0 41 / p1 44 / concurrency 83 / finance 103 / integration 96 / warehouse-scope 24 / pda-device-session 22 / 权限 169（+accounting.period.manage）/ test:accounting 7 / smoke:accounting 11 / sale-adjustment 57 / test:label 5 / test:print 15。~~serial-consistency 冒烟已随序列号体系删除~~。tsc 0、两端 lint 0（前端 5 条 react-refresh warning 是存量）。

## 本会话关键设计决策（改这些之前必读）

- **07 拒收处置零 GL**：拒收量从收货起就在 `inventory_stock` 与应付之外（`rejected_qty` 永不 `putaway`），处置只作废 REJECTED 容器 → **零 GL / 零库存缓存 / 不出凭证**。设计文档 §9「冲减应付」是笔误，已订正。voucher-engine 不认识 `inbound_qa_dispositions` 表。
- **04 序列号退货口径统一 status=1**：核心不变量 `assertSerialCountMatchesContainer` 要求「容器 remaining_qty == 该容器 status=1 SN 数」，故退回单位一律置在库(1)，可售性由**容器状态**（PENDING_QA 不计可用）把关，不靠 SN 状态。偏离设计原稿的 3已退货中间态，已文档说明。
- **03 多单位方案 A（`utils/unitConversion.js` 共享）**：库存事实层永远只用**基本单位**记数；`quantity=entryQty×rate`、`unit_price=entryUnitPrice÷rate`(高精度 18,8)、`amount=entryQty×entryUnitPrice`(合同金额零误差)；**entry 三列只回显/打印/审计，绝不进库存/账款计算**。约定：API 入参 `quantity/unitPrice` 恒为**录入单位**口径，`entryUnit` 缺省=基本单位→rate 1→完全向后兼容（现有商品/行字节级不变，自然灰度）。**改单必须先折算再算 delta**（否则箱量与旧件量错配、WMS 增减全错）。
- **07 让步接收=旁路子集**（`concession_qty`，迁移188）：让步是**合格量(passedQty)的子集**（concession≤passed），不是第四种数量流——`passedQty`(含让步) 仍全进 PENDING_PUTAWAY→上架→结算，`concession_qty` 只作质量统计，**结算/库存/容器分流一字不改**（`allocateInboundQaContainers` 仍按 passed/rejected 分流）。report 双口径：`passRate`(宽=含让步，向后兼容) + `strictPassRate`(严=扣让步)。PDA check 三桶「正常合格/让步/拒收」，前端合成 `passedQty=正常+让步` 传后端；服务层 + route zod 双拦 `concession≤passed`。这是设计 07 §11/§5.104 明确的方案。

## 实现纪律

- 动库存/账款/占库/结算/状态机前**读透调用链**（engine/常量文件注释记录历史事故根因）。
- 改后跑齐 smoke：`mainline`(必)、涉库存加 `p0/p1/integration`、并发加 `concurrency-guards`、财务加 `finance`、数据权限加 `warehouse-scope`、序列号加 `serial-consistency`、销售改单加 `sale-adjustment`、多单位金额务必端到端验「应付/应收=合同金额」。
- 新权限码**三处同步**（后端 permissions.js + 前端 permission-codes.ts + seed 迁移）+ `test:permissions`（当前各 168）。前端全 camelCase / `SoftStatusLabel` / 数字列 `tabular-nums` / 不复制后端业务规则。迁移只新增。

## 发版（本会话已授权自主发版）

- 用 `/release-flowcube` 技能。**先写 `docs/release-notes/<版本>.md` 再跑 `bump-version.sh`**（脚本读 notes 填 PDA releaseNote；先写 notes 才不用回头补 PDA 说明；**PDA versionCode 不幂等，别重跑 bump**）；三端 + PDA 版本同步。
- **精确 git add**：工作区常混别的 chat 的 WIP（本会话就有 `HANDOFF.md` 那份），`git add -A && git restore --staged docs/proposals/HANDOFF.md` 再 commit（见记忆 `release-dirty-worktree-technique`）。tag 前工作区要干净 → `git stash push HANDOFF.md` → `npm run release:tag-desktop` → `git stash pop`。
- 发完盯 **tag** 的 Build Desktop Installer（不是 push-main 那条）跑完，`curl -sk https://47.93.228.251/latest.json` 确认 version 翻新、`/api/pda/version` 也翻新。

## 环境坑（本会话踩到）

- **cwd 会漂到 `backend/`**（脚本里 `cd backend` 后不复位）→ 相对路径命令失败。**统一用绝对路径**或每条命令前 `cd /Users/chengjianghao/flowcube`。
- **共享 Browser 面板被另一 chat 争用**：screenshot/scroll/click 会间歇 timeout（"pane hidden"）；`get_page_text` 更稳。验收优先文本读取。接手会话实测：`preview_start {url:'http://localhost:5173/#/...'}` + `get_page_text` **能到达另一 chat 已登录的 5173**（PostToolUse hook 警告"reach 不到"是保守默认，实际可达）；PDA 页仍须 `tabs_create` 开新标签（跨端守卫）。
- tmp 脚本删除也用绝对路径（cwd 漂移时 `rm backend/scripts/x.js` 会删错位置、静默不报错，git status 里就会残留 `??`）。
- **zsh `status` 是只读变量**：轮询 CI 的循环里 `status=$(...)` 会 `read-only variable` 直接失败，改用 `st`/`dst` 等别名。

## 接手怎么继续

读上述三条记忆 + `docs/proposals/README.md`。功能 10 会计已完结。剩余按用户拍板的优先级推进（03 Phase4 / 07 AQL 等）；若用户说「继续」就按本会话节奏（自己实现→端到端自验→全量回归→分版发布→验 latest.json）往下清。动多单位金额/序列号/账款前，先读 `utils/unitConversion.js`、`engine/serialEngine.js`、对应设计文档。
