# 2026-10-08 全系统设计审查覆盖地图

源码提交：`66fa87e4a0c440270189693480673c69320bce85`；扫描源码快照：`f1fc22b9a7464df4e926cbfcd624b9f9aa78e7e81c67a80e51d14b717f141ac3`（仅本脚本allowlist，不是整工作树/GUI截图版本指纹）。

本文件包含静态覆盖地图与按具体路径/条件登记的审查证据。route、import、JSX、共享组件能力、截图捕获或测试文件存在均不能证明 GUI/业务/权限/真机/打印验收。所有新记录未查看、未执行；入口总览、人工细看、交互和状态验证分别记录，不能相互代替。

可复跑：`node scripts/design-audit/inventory.mjs`；只检查清单是否与当前源码相符：`node scripts/design-audit/inventory.mjs --check`。需要 frontend 的 TypeScript 开发依赖。脚本只读 allowlist 和自身输出，不加载应用，不读取敏感配置。

人工补充用途、分类、问题与验收结论请编辑 coverage.json 的 manual、actualView、issues、modified、verification、uncoveredReason、reviewSourceSnapshot 字段，再复跑以同步本文。不要编辑自动生成的 route/source/states/calls。验收结论应绑定实际源码快照及具体路径/条件。

## 数量与来源

路由 145 条（实际入口 138、兼容别名 6、未知地址回退 1；PDA 33；动态 26、新建 12、仅登录恢复 3）。有人工查看证据 124 条，其中入口总览 110、代表状态细看 56、实际交互 44（相互重叠，不能相加）。已捕获 134 条，捕获不等于人工细看。

弹窗、抽屉、选择器、浮层、状态/导航表面调用 1155 个；全部大写 JSX 组件调用 5532 个；状态组件定义 30 个。扫描源码 637 文件，可达 632，未从现入口可达 5。共享组件与用方不会被换算成已验收。

具有指定条件人工查看/交互证据的调用点 55 个，仍无此证据 1100 个；即使已有一项证据，也不代表七种状态或全部 relatedRoutes 通过。

## 已合入证据与待验收

固定人工核对索引合入明确截图/DOM/交互记录；依据A/B/root/本审查者声明指定证据层级。不从文件存在、import、组件测试或其他用方推导通过。Root108入口仅缩略图布局概览；A固定67+41+11=119图及本审查者44+11+9=64图逐张细看；后续新截图只随明确索引追加。

coverage.json 的 evidenceIndex 收录 466 条明确来源索引，保留观察路径、截图、阶段、人工查看/交互与调用记录关联。问题列的F01–F17对应 findings.md；映射仅表示源/调用影响范围，完整逐项结论及验证边界在JSON，不表示本页已经复现或全状态通过。

- observations-before.json:92入口捕获；root已查看contact-before01–08入口总览
- observations-after.json:108requested paths；root已查看contact-after01–12布局概览，捕获时login为认证跳转
- observations-fluid-final/scroll.json:12四fluid页面768/1024/1440布局图+4实际右端滚动/回左图均root逐张看；无selection列，不升级B后续preview修正为已验
- observations-root-final.json:10 ERP合成动态路径/标题回读仍仅overview；5代表状态含未认证login4图、sale日期、Finder/草稿、供应商退款、合法procurement1详情，第16追加Description收口后浅深各0viol/1incomplete；旧1viol与0viol/2incomplete都保留
- assessment-a.md:20before截图已查看，表单只打开/取消
- a-after.md + a-gui-followup.md:固定46+21=67图逐张细看；真实列表错误/重试/标签与最终ink/nav，组件11文件56例
- a-followup-overlays.md + a-followup-screens.json:固定25+16=41图逐张细看；独立浮层指定入口/标签/草稿/空态/受阻；追加5文件42组件例/11路径lint0/完整tsc0
- a-final-screens.json + 脱敏read JSON:固定11图逐张细看；真实模板400/重试、invoice abort→200、有效日期未blur/两层Escape/恢复、物流日期名称；override前样本保留
- a-backend-read.md + a-api-read-green.json:退款真实API红到绿9例；PDA实际/my与/my-sku-summary及代表报表200仅API证据，错误/my-tasks探测排除
- assessment-b.md + observations-pda-before.json:19PDA路由捕获与指定样本细看
- implementation-b.md + observations-pda-after/final.json + evidence-b/pda-320-reachability.json:明确320/部分390实际阶段与交互，193组件例；原生/业务提交未验
- observations-crud-after.json:8用方44图逐张细看与限定草稿交互，未提交；BODY回焦缺陷保留
- observations-focus-after/extras.json:8+3图逐张细看；8用方回原字段/新增button、实际供应商仅Radix变化、客户guard兼容、合法计划受控浮层回焦；override前版本，不推广最终依赖全GUI
- observations-workspace-final/c-final-shared.json:最终canonical9图逐张看；客户两商品qty1.25/2备注切换保留、真实close取消/确认、等autoFocus返回原close按钮；768日期2→1→0返回、1024仅Radix变化保留/回combobox/放弃；Description小收口前指定样本
- workspace-tabs-validation.md:指定工作区键盘/草稿/axe测试与真实GUI
- shared-components-review.md:独立源码/调用链与最小回归；未自动推广业务用方GUI
- evidence-b/fluid-selection-preview/final-dom.json:最终5+2组件夹具图B逐张细看，56px选择/60:20:20归一业务权重/原生checkbox/opaque hover/表内scrollLeft；保留calc均分与透字反例、403/未挂载harness；不是4业务页面或物理横轮验收

共享组件专项（不替代业务用方验收）：

- {"source":"dialog.focus + BaseCrudPage.draft + independentDialogs.draft + WorkspaceTabs.keyboard + DatePicker.accessibility","result":"最终canonical dismissable-layer1.1.13/focus-scope1.1.16真实组件5文件47例通过；保留1.1.19 nested Escape自然失败历史；只证明这些行为夹具，不提升全部GUI","log":"/tmp/flowcube-dialog-focus-final-green.log"}
- {"source":"DataTable.test.tsx + statusTone.contrast.test.ts + BaseCrudPage.feedback.test.tsx + BaseCrudPage.draft.test.tsx","result":"较早独立最小回归4文件41例通过；BaseCrud真实Radix BubbleInput、取消/隐藏pending/关闭保护和权限fixture；不是最终全量或全GUI","log":"/tmp/flowcube-shared-independent-review-final.log"}
- {"source":"dialog.focus + BaseCrudPage.draft + independentDialogs.draft + WorkspaceTabs.keyboard","result":"较早override前公共Dialog/AppDialog真实回焦、BaseCrud/A草稿handler兼容、标签键盘：4文件44例通过；AppDialog单独自然red，7路径scoped lint0；fresh GUI另列，不能全用方推广","log":"/tmp/flowcube-dialog-focus-green.log"}

明确待办（完整缺口仍在每条 route / surface 的 uncoveredReason 和 stateReview）：

- A/B已明确的GUI、API、组件测试各自独立；低权限/详情延迟/缓存反例主要是组件夹具；A固定新增41+11图已合入指定入口；最终canonical后关键GUI9图已明确追加，不自动推广全部用方；Description收口RF1浅深/Tab回焦/0viol1incomplete已另加；其他ARIA用方仍待逐用方；DataTable最终选择夹具5+2图另有组件范围证据，不外推业务路线。
- /login 旧总览为认证跳转已保留；root-final真实未认证正常/401/空密码禁用浅深4图已合入；未知及全键盘未验。/pda/login仍待未登录会话验收。
- 全部26动态pattern继续逐权限/阶段/子表面验收；11 ERP具体路径/标题已回读，其中10仅overview、procurement1代表详情细看；transfer403/logistics缺合法fixture保留；receive2、putaway1/2、task1为明确读取样本；check/pack1仅阶段禁止；ship1仅不消费ID的扫描初态，不能代表动态详情或执行流程。
- 1149表面是候选调用点；没有指定记录的弹窗、抽屉、选择器、状态用方继续未查看。新增调用点也保持待验。
- 备注11调用方除实际sales样本外逐用方键盘展开/收起、长文、虚拟列表、查询切换及窄屏待验。
- BaseCrud8用方已限定真实代表输入/Tab/Escape/继续/放弃/重开，塑料盒两回调及各单独变化实际确认保留；原BODY失败与8用方1024浅色fresh回焦成功分别保留，最终canonical供应商仅Radix变化和salesclose/日期关键样本已追加。pending Portal/遮罩、隐藏迟到成功、逐权限GUI仍待验，组件测试不替代。
- statusTone对比计算证明指定token背景；94文本颜色用方各自背景、alpha、浅深与语义不能由计算测试统一通过。
- Android广播/相机/软键盘/实体返回键、Windows原生弹窗、物理打印、CI/生产/发布均无本清单验收证据。
- 尚无人工细看或入口总览声明的21个路由（部分仅自动捕获）：/transfer/:id、/logistics/:id、*、/pda/adjustments、/pda/adjustments/:id、/pda/cancel-return、/pda/cancel-return/:id、/pda/check、/pda/inbound、/pda/login、/pda/pack、/pda/putaway、/pda/sale-return、/pda/sale-return/:id/putaway、/pda/sale-return/:id/receive、/pda/ship、/pda/stockcheck、/pda/stockcheck/:id、/pda/transfer、/pda/transfer-in/:id、/pda/transfer-out/:id。具体动态阶段/权限原因与静态只捕获状态分别保留，不称全部入口已验收。

| 分类 | 路由 | 子表面调用候选 |
| --- | ---: | ---: |
| 销售 | 10 | 160 |
| 采购 | 13 | 82 |
| 库存仓储 | 24 | 203 |
| 财务会计 | 32 | 260 |
| 基础资料 | 8 | 71 |
| 审批待办 | 5 | 37 |
| 打印物流 | 10 | 58 |
| 系统设置 | 10 | 82 |
| PDA | 33 | 202 |

入口来源：

- `frontend/src/router/routeDefinitions.ts`
- `frontend/src/router/routeRegistry.ts`
- `frontend/src/router/index.tsx`
- `frontend/src/router/pdaRoutes.tsx`
- `frontend/src/router/mergedPageGroups.ts`
- `frontend/src/components/shared/MergedPage.tsx`
- `frontend/src/pages/warehouse-structure/index.tsx`
- `frontend/src/pages/pda/index.tsx`
- `frontend/src/components/shared/DailyWork.tsx`
- `frontend/src/main.tsx`

## 状态与证据口径

loading / empty / error / denied / disabled / success / unknown 每项分别记录。线索表示实际 JSX 文案/属性、条件渲染、反馈调用或状态组件调用；仍须触发后查看。待核表示未提取到呈现线索，不表示没有实现。完整源码行号、条件与片段在 coverage.json 的 states；调用点自身与定义文件能力分开记录，definitionStateRef / componentDefinitions 不能替代用方验收。

导航“隐藏”只指没有常驻顶栏或 PDA ALL_OPS 注册；动态表单、条件入口、工作区子视图仍可能通过实际操作到达。合并组权限过滤/顶栏去重单独登记。

## 销售

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/credit-overrides` | 超额放行申请 / 超额放行申请；当前已注册页面或工作区子视图 | `frontend/src/pages/credit-overrides/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:172 | 顶栏可见候选（按权限过滤） | 38 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/returns/sale` | 销售退货 / 销售退货；当前已注册页面或工作区子视图 | `frontend/src/pages/returns/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:163 | 顶栏可见候选（按权限过滤） | 41 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/returns/sale/:id` | 销售退货单 #<id> / 销售退货单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/returns/sale/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:936 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 41 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/returns/sale/new` | 新建销售退货单 / 新建销售退货单；创建、录入与保存表面 | `frontend/src/pages/returns/sale/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:927 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 41 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sale` | 销售订单 / 销售订单；当前已注册页面或工作区子视图 | `frontend/src/pages/sale/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:153 | 顶栏可见候选（按权限过滤） | 50 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已实际查看并操作本轮合成状态；完整界限见sale-entry-recovery.md | F02/P1；F04/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2；SRE01：普通与成套统一开单未集成到main，预览仍暴露两个入口；已恢复原实现并验收，保留各自业务保存模型。 | 已恢复统一开单及依赖资料；保留本轮UI改动 | 本轮指定合成状态与保存/重开通过；未代表全部状态或业务执行；测试 全前端265文件/2006例通过；另销售/成套/数量专项 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sale/:id` | 销售单 #<id> / 销售单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/sale/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:837 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 98 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:线索 | 已实际查看并操作本轮合成状态；完整界限见sale-entry-recovery.md | F02/P1；F04/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 已恢复统一开单及依赖资料；保留本轮UI改动 | 本轮指定合成状态与保存/重开通过；未代表全部状态或业务执行；测试 全前端265文件/2006例通过；另销售/成套/数量专项 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sale/create-recovery` | 开单结果核对 / 本人原请求结果核对；登录准入，原业务权限与写权限仍须按页面核查 | `frontend/src/pages/sale/RepeatSaleRecoveryPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:996 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 1 | loading:待核；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sale/new` | 新建销售单 / 新建销售单；创建、录入与保存表面 | `frontend/src/pages/sale/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:828 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 98 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:线索 | 已实际查看并操作本轮合成状态；完整界限见sale-entry-recovery.md | F02/P1；F04/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2；SRE01：普通与成套统一开单未集成到main，预览仍暴露两个入口；已恢复原实现并验收，保留各自业务保存模型。 | 已恢复统一开单及依赖资料；保留本轮UI改动 | 本轮指定合成状态与保存/重开通过；未代表全部状态或业务执行；测试 全前端265文件/2006例通过；另销售/成套/数量专项 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sale/new-kit` | 新建套销售 / 新建套销售；创建、录入与保存表面 | `frontend/src/pages/sale/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:88 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 98 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F02/P1；F04/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sales` | 旧地址 → /sale / 兼容旧地址，重定向至 /sale | `frontend/src/pages/sale/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:153；→ /sale | 隐藏；旧地址兼容跳转 | 0 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为 |

## 采购

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/procurement` | 采购建议 / 采购建议；当前已注册页面或工作区子视图 | `frontend/src/pages/procurement/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:112；采购建议 / 采购计划 | 顶栏可见候选（按权限过滤） | 13 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/procurement/:id` | 采购计划 #<id> / 采购计划 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/procurement/detail.tsx`；注册 frontend/src/router/routeDefinitions.ts:864 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 28 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F12/P2；F13/P2；F15/P2；F16/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/purchase` | 采购订单 / 采购订单；当前已注册页面或工作区子视图 | `frontend/src/pages/purchase/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:94 | 顶栏可见候选（按权限过滤） | 42 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F03/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/purchase-requisitions` | 采购申请 / 采购申请；当前已注册页面或工作区子视图 | `frontend/src/pages/purchase-requisitions/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:103 | 顶栏可见候选（按权限过滤） | 21 | loading:线索；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/purchase-requisitions/:id` | 采购申请单 #<id> / 采购申请单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/purchase-requisitions/form.tsx`；注册 frontend/src/router/routeDefinitions.ts:882 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 41 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/purchase-requisitions/new` | 新建采购申请单 / 新建采购申请单；创建、录入与保存表面 | `frontend/src/pages/purchase-requisitions/form.tsx`；注册 frontend/src/router/routeDefinitions.ts:873 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 41 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/purchase/:id` | 采购订单 #<id> / 采购订单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/purchase/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:855 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 48 | loading:线索；empty:线索；error:待核；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/purchase/new` | 新建采购单 / 新建采购单；创建、录入与保存表面 | `frontend/src/pages/purchase/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:846 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 48 | loading:线索；empty:线索；error:待核；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/replenishment` | 采购建议 / 采购建议；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/replenishment.tsx`；注册 frontend/src/router/routeDefinitions.ts:629；采购建议 / 补货建议 | 合并工作区子视图（顶栏组项去重） | 21 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F16/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/returns` | 旧地址 → /returns/purchase / 兼容旧地址，重定向至 /returns/purchase | `frontend/src/pages/returns/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:130；→ /returns/purchase | 隐藏；旧地址兼容跳转 | 0 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F01/P1；F13/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为 |
| `/returns/purchase` | 采购退货 / 采购退货；当前已注册页面或工作区子视图 | `frontend/src/pages/returns/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:130 | 顶栏可见候选（按权限过滤） | 41 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/returns/purchase/:id` | 采购退货单 #<id> / 采购退货单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/returns/purchase/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:918 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 42 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/returns/purchase/new` | 新建采购退货单 / 新建采购退货单；创建、录入与保存表面 | `frontend/src/pages/returns/purchase/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:909 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 42 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## 库存仓储

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/disposals` | 滞销库存处理 / 滞销库存处理；当前已注册页面或工作区子视图 | `frontend/src/pages/disposal/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:276 | 顶栏可见候选（按权限过滤） | 65 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/disposals/new` | 来源报废草稿 / 来源报废草稿；创建、录入与保存表面 | `frontend/src/pages/disposal/HandlingScrapPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:275 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 7 | loading:待核；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F15/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/disposals/recovery` | 报废结果核对 / 本人原请求结果核对；登录准入，原业务权限与写权限仍须按页面核查 | `frontend/src/pages/disposal/DisposalRecoveryPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:989 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 2 | loading:待核；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/inbound-tasks` | 收货订单 / 收货订单；当前已注册页面或工作区子视图 | `frontend/src/pages/inbound-tasks/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:121 | 顶栏可见候选（按权限过滤） | 40 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/inbound-tasks/:id` | 收货订单 #<id> / 收货订单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/inbound-tasks/detail.tsx`；注册 frontend/src/router/routeDefinitions.ts:954 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 27 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/inbound-tasks/new` | 新建收货订单 / 新建收货订单；创建、录入与保存表面 | `frontend/src/pages/inbound-tasks/create.tsx`；注册 frontend/src/router/routeDefinitions.ts:945 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 18 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F11/P2；F12/P2；F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/inventory` | 库存管理 / 库存管理；当前已注册页面或工作区子视图 | `frontend/src/pages/inventory/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:229 | 顶栏可见候选（按权限过滤） | 54 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/inventory/overview` | 旧地址 → /inventory / 兼容旧地址，重定向至 /inventory | `frontend/src/pages/inventory/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:229；→ /inventory | 隐藏；旧地址兼容跳转 | 0 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F13/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为 |
| `/inventory/trace` | 批次追溯 / 批次追溯；当前已注册页面或工作区子视图 | `frontend/src/pages/inventory/trace.tsx`；注册 frontend/src/router/routeDefinitions.ts:248 | 顶栏可见候选（按权限过滤） | 0 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/locations` | 库位管理 / 库位管理；当前已注册页面或工作区子视图 | `frontend/src/pages/locations/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:350 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 27 | loading:待核；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/picking-waves` | 批次拣货 / 批次拣货；当前已注册页面或工作区子视图 | `frontend/src/pages/picking-waves/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:332 | 顶栏可见候选（按权限过滤） | 34 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/plastic-boxes` | 塑料盒管理 / 塑料盒管理；当前已注册页面或工作区子视图 | `frontend/src/pages/plastic-boxes/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:239 | 顶栏可见候选（按权限过滤） | 41 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/racks` | 货架管理 / 货架管理；当前已注册页面或工作区子视图 | `frontend/src/pages/racks/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:358 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 27 | loading:待核；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/inventory-aging` | 存放时长与滞销 / 存放时长与滞销；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/inventory-aging.tsx`；注册 frontend/src/router/routeDefinitions.ts:638 | 顶栏可见候选（按权限过滤） | 20 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/pda-anomaly` | 仓库运营 / 仓库运营；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/pda-anomaly.tsx`；注册 frontend/src/router/routeDefinitions.ts:665；仓库运营 / PDA 异常 | 合并工作区子视图（顶栏组项去重） | 7 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F15/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/warehouse-ops` | 仓库运营 / 仓库运营；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/warehouse-ops.tsx`；注册 frontend/src/router/routeDefinitions.ts:647；仓库运营 / 作业概况 | 顶栏可见候选（按权限过滤） | 3 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/wave-performance` | 仓库运营 / 仓库运营；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/wave-performance.tsx`；注册 frontend/src/router/routeDefinitions.ts:656；仓库运营 / 批次效率 | 合并工作区子视图（顶栏组项去重） | 13 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/sorting-bins` | 分拣格管理 / 分拣格管理；当前已注册页面或工作区子视图 | `frontend/src/pages/sorting-bins/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:366 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 35 | loading:待核；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/stockcheck` | 库存盘点 / 库存盘点；当前已注册页面或工作区子视图 | `frontend/src/pages/stockcheck/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:257 | 顶栏可见候选（按权限过滤） | 31 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/stockcheck/abc` | 分档与盘点规则 / 分档与盘点规则；当前已注册页面或工作区子视图 | `frontend/src/pages/stockcheck/abc.tsx`；注册 frontend/src/router/routeDefinitions.ts:266 | 顶栏可见候选（按权限过滤） | 15 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/transfer` | 库存调拨 / 库存调拨；当前已注册页面或工作区子视图 | `frontend/src/pages/transfer/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:285 | 顶栏可见候选（按权限过滤） | 37 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/transfer/:id` | 调拨单 #<id> / 调拨单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/transfer/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:900 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 42 | loading:线索；empty:线索；error:待核；denied:线索；disabled:线索；success:线索；unknown:待核 | 未查看 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 本批新仓3合成资源API回读403，当前scope仅仓1（erp-dynamic-review.json）；未扩大权限。尚缺合法在范围的具体调拨详情GUI，API403不替代页面权限呈现验收。 |
| `/transfer/new` | 新建调拨单 / 新建调拨单；创建、录入与保存表面 | `frontend/src/pages/transfer/form/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:891 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 42 | loading:线索；empty:线索；error:待核；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/warehouses` | 仓库管理 / 仓库管理；当前已注册页面或工作区子视图 | `frontend/src/pages/warehouses/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:341 | 顶栏可见候选（按权限过滤） | 23 | loading:待核；empty:待核；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## 财务会计

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/accounting/accounts` | 会计科目表 / 会计科目表；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/accounts/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:470 | 顶栏可见候选（按权限过滤） | 15 | loading:线索；empty:线索；error:待核；denied:线索；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/backfills` | 跨期补录审批 / 跨期补录审批；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/backfills/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:579 | 顶栏可见候选（按权限过滤） | 20 | loading:线索；empty:待核；error:待核；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/consolidation` | 合并报表与账套 / 合并报表与账套；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/consolidation/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:561 | 顶栏可见候选（按权限过滤） | 11 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/fixed-assets` | 固定资产 / 固定资产；当前已注册页面或工作区子视图 | `frontend/src/pages/fixed-assets/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:552 | 顶栏可见候选（按权限过滤） | 19 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/invoices` | 发票管理 / 发票管理；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/invoices/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:506 | 顶栏可见候选（按权限过滤） | 25 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F04/P1；F05/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/ledger` | 总账与试算平衡 / 总账与试算平衡；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/ledger/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:488 | 顶栏可见候选（按权限过滤） | 8 | loading:线索；empty:线索；error:待核；denied:待核；disabled:待核；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/periods` | 会计期间与结转 / 会计期间与结转；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/periods/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:543 | 顶栏可见候选（按权限过滤） | 11 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/reports` | 会计报表 / 会计报表；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/reports/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:497 | 顶栏可见候选（按权限过滤） | 2 | loading:线索；empty:线索；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/tax` | 报税数据 / 报税数据；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/tax/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:570 | 顶栏可见候选（按权限过滤） | 5 | loading:待核；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/accounting/vouchers` | 记账凭证 / 记账凭证；当前已注册页面或工作区子视图 | `frontend/src/pages/accounting/vouchers/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:479 | 顶栏可见候选（按权限过滤） | 35 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/finance/accounts` | 资金工作区 / 资金工作区；当前已注册页面或工作区子视图 | `frontend/src/pages/finance/accounts/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:432；资金工作区 / 账户管理 | 合并工作区子视图（顶栏组项去重） | 26 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/finance/dashboard` | 资金工作区 / 资金工作区；当前已注册页面或工作区子视图 | `frontend/src/pages/finance/dashboard/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:423；资金工作区 / 资金看板 | 顶栏可见候选（按权限过滤） | 8 | loading:线索；empty:线索；error:线索；denied:线索；disabled:待核；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F12/P2；F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/finance/expense-categories` | 费用类别 / 费用类别；当前已注册页面或工作区子视图 | `frontend/src/pages/finance/expense-categories/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:459 | 顶栏可见候选（按权限过滤） | 22 | loading:待核；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/finance/expenses` | 费用报销 / 费用报销；当前已注册页面或工作区子视图 | `frontend/src/pages/finance/expenses/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:450 | 顶栏可见候选（按权限过滤） | 41 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/finance/transactions` | 资金工作区 / 资金工作区；当前已注册页面或工作区子视图 | `frontend/src/pages/finance/transactions/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:441；资金工作区 / 资金流水 | 合并工作区子视图（顶栏组项去重） | 21 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/payments` | 旧地址 → /payments/payable / 兼容旧地址，重定向至 /payments/payable | `frontend/src/components/shared/MergedPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:376；→ /payments/payable | 隐藏；旧地址兼容跳转 | 0 | loading:线索；empty:待核；error:待核；denied:线索；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为 |
| `/payments/ledger/customer/:id` | 客户往来明细 #<id> / 客户往来明细 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/payments/party-ledger.tsx`；注册 frontend/src/router/routeDefinitions.ts:820 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 16 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/payments/ledger/supplier/:id` | 供应商往来明细 #<id> / 供应商往来明细 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/payments/party-ledger.tsx`；注册 frontend/src/router/routeDefinitions.ts:820 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 16 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/payments/payable` | 供应商往来 / 供应商往来；当前已注册页面或工作区子视图 | `frontend/src/pages/payments/payable.tsx`；注册 frontend/src/router/routeDefinitions.ts:376；供应商往来 / 现结账款 | 顶栏可见候选（按权限过滤） | 70 | loading:待核；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F10/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/payments/receivable` | 客户往来 / 客户往来；当前已注册页面或工作区子视图 | `frontend/src/pages/payments/receivable.tsx`；注册 frontend/src/router/routeDefinitions.ts:386；客户往来 / 现结账款 | 顶栏可见候选（按权限过滤） | 70 | loading:待核；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F10/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/portal/statements` | 客户对账单查询 / 客户对账单查询；当前已注册页面或工作区子视图 | `frontend/src/pages/portal/statements.tsx`；注册 frontend/src/router/routeDefinitions.ts:199 | 顶栏可见候选（按权限过滤） | 18 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F11/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/refunds` | 退货退款单 / 退货退款单；当前已注册页面或工作区子视图 | `frontend/src/pages/refunds/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:532 | 顶栏可见候选（按权限过滤） | 41 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | A1：读取500被画成空结果/共0；后端错误与UI缺少错误呈现分别核对；F01/P1；F04/P1；F07/P1；F08/P1；F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports` | 报表中心 / 报表中心；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:593；报表中心 / 业务统计 | 顶栏可见候选（按权限过滤） | 23 | loading:线索；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/avg-cost-reconciliation` | 成本对账 / 成本对账；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/avg-cost-reconciliation.tsx`；注册 frontend/src/router/routeDefinitions.ts:611 | 顶栏可见候选（按权限过滤） | 9 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/kpi` | 报表中心 / 报表中心；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/kpi.tsx`；注册 frontend/src/router/routeDefinitions.ts:620；报表中心 / 经营概览 | 合并工作区子视图（顶栏组项去重） | 9 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F13/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/profit-analysis` | 报表中心 / 报表中心；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/profit-analysis.tsx`；注册 frontend/src/router/routeDefinitions.ts:602；报表中心 / 利润与库存 | 合并工作区子视图（顶栏组项去重） | 16 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/reconciliation` | 旧地址 → /reports/reconciliation/payable / 兼容旧地址，重定向至 /reports/reconciliation/payable | `frontend/src/components/shared/MergedPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:395；→ /reports/reconciliation/payable | 隐藏；旧地址兼容跳转 | 0 | loading:线索；empty:待核；error:待核；denied:线索；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为 |
| `/reports/reconciliation/payable` | 供应商往来 / 供应商往来；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/reconciliation-payable.tsx`；注册 frontend/src/router/routeDefinitions.ts:395；供应商往来 / 月结对账 | 合并工作区子视图（顶栏组项去重） | 65 | loading:待核；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/reconciliation/receivable` | 客户往来 / 客户往来；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/reconciliation-receivable.tsx`；注册 frontend/src/router/routeDefinitions.ts:405；客户往来 / 月结对账 | 合并工作区子视图（顶栏组项去重） | 65 | loading:待核；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/supplier-refunds` | 供应商退款 / 供应商退款；当前已注册页面或工作区子视图 | `frontend/src/pages/supplier-refunds/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:515 | 顶栏可见候选（按权限过滤） | 27 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F07/P1；F08/P1；F12/P2；F13/P2；F14/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/supplier-refunds/new` | 供应商退款 / 供应商退款；创建、录入与保存表面 | `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:524 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 9 | loading:待核；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F07/P1；F12/P2；F13/P2；F14/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/supplier-refunds/recovery` | 退款结果核对 / 本人原请求结果核对；登录准入，原业务权限与写权限仍须按页面核查 | `frontend/src/pages/supplier-refunds/RefundRecoveryPage.tsx`；注册 frontend/src/router/routeDefinitions.ts:982 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 1 | loading:待核；empty:待核；error:线索；denied:待核；disabled:待核；success:待核；unknown:线索 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## 基础资料

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/categories` | 商品分类 / 商品分类；当前已注册页面或工作区子视图 | `frontend/src/pages/categories/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:312 | 顶栏可见候选（按权限过滤） | 16 | loading:线索；empty:线索；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/customers` | 客户管理 / 客户管理；当前已注册页面或工作区子视图 | `frontend/src/pages/customers/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:190 | 顶栏可见候选（按权限过滤） | 30 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F01/P1；F03/P1；F04/P1；F05/P1；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 A实际组件/React Query相关用例通过，11文件56例合计；本页限定用例见a-after.md:2 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/kits` | 成套配件 / 成套配件；当前已注册页面或工作区子视图 | `frontend/src/pages/kits/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:303 | 顶栏可见候选（按权限过滤） | 38 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/price-change` | 商品改价申请 / 商品改价申请；当前已注册页面或工作区子视图 | `frontend/src/pages/price-change/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:321 | 顶栏可见候选（按权限过滤） | 34 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/products` | 商品管理 / 商品管理；当前已注册页面或工作区子视图 | `frontend/src/pages/products/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:294 | 顶栏可见候选（按权限过滤） | 31 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F11/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/products/:id` | 编辑商品 #<id> / 编辑商品 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/products/form.tsx`；注册 frontend/src/router/routeDefinitions.ts:811 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 25 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F11/P2；F12/P2；F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/products/new` | 新增商品 / 新增商品；创建、录入与保存表面 | `frontend/src/pages/products/form.tsx`；注册 frontend/src/router/routeDefinitions.ts:800 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 25 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F11/P2；F12/P2；F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/suppliers` | 供应商管理 / 供应商管理；当前已注册页面或工作区子视图 | `frontend/src/pages/suppliers/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:142 | 顶栏可见候选（按权限过滤） | 26 | loading:待核；empty:待核；error:线索；denied:线索；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## 审批待办

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/approvals/flows` | 审批流配置 / 审批流配置；当前已注册页面或工作区子视图 | `frontend/src/pages/approvals/flows.tsx`；注册 frontend/src/router/routeDefinitions.ts:725 | 顶栏可见候选（按权限过滤） | 25 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F04/P1；F05/P1；F09/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/approvals/pending` | 待我审批 / 待我审批；当前已注册页面或工作区子视图 | `frontend/src/pages/approvals/pending.tsx`；注册 frontend/src/router/routeDefinitions.ts:716 | 顶栏可见候选（按权限过滤） | 7 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F13/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/dashboard` | 仪表盘 / 仪表盘；当前已注册页面或工作区子视图 | `frontend/src/pages/dashboard/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:78 | 顶栏可见候选（按权限过滤） | 24 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/reports/exception-workbench` | 旧地址 → /reports/role-workbench / 兼容旧地址，重定向至 /reports/role-workbench | `frontend/src/pages/reports/role-workbench.tsx`；注册 frontend/src/router/routeDefinitions.ts:674；→ /reports/role-workbench | 隐藏；旧地址兼容跳转 | 0 | loading:线索；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 旧地址跳转与当前观察URL见证据；目标页查看不替代跳转验证或业务行为 |
| `/reports/role-workbench` | 待办中心 / 待办中心；当前已注册页面或工作区子视图 | `frontend/src/pages/reports/role-workbench.tsx`；注册 frontend/src/router/routeDefinitions.ts:674 | 顶栏可见候选（按权限过滤） | 15 | loading:线索；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2；F13/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## 打印物流

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/carrier-accounts` | 快递账号绑定 / 快递账号绑定；当前已注册页面或工作区子视图 | `frontend/src/pages/carrier-accounts/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:218 | 顶栏可见候选（按权限过滤） | 15 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F15/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/carriers` | 承运商管理 / 承运商管理；当前已注册页面或工作区子视图 | `frontend/src/pages/carriers/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:208 | 顶栏可见候选（按权限过滤） | 25 | loading:待核；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | C-focus-resume：继续编辑保留输入但焦点实际落到BODY；原图/DOM失败保留；F03/P1；F04/P1；F05/P1；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/logistics` | 物流运单 / 物流运单；当前已注册页面或工作区子视图 | `frontend/src/pages/logistics/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:181 | 顶栏可见候选（按权限过滤） | 23 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/logistics/:id` | 运单 #<id> / 运单 #<id>；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/logistics/detail.tsx`；注册 frontend/src/router/routeDefinitions.ts:791 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 28 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:线索 | 未查看 | F09/P2；F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 本批尚无合法具体运单ID/详情读取证据；不能以销售ID替代运单ID；未为视觉验收调用真实承运商取号。 |
| `/logistics/freight-reconciliation` | 运费对账 / 运费对账；当前已注册页面或工作区子视图 | `frontend/src/pages/logistics/freight-reconciliation.tsx`；注册 frontend/src/router/routeDefinitions.ts:414 | 顶栏可见候选（按权限过滤） | 13 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings/barcode-print-query` | 条码打印查询 / 条码打印查询；当前已注册页面或工作区子视图 | `frontend/src/pages/settings/barcode-print-query/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:705 | 顶栏可见候选（按权限过滤） | 14 | loading:线索；empty:待核；error:线索；denied:线索；disabled:待核；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings/print-templates` | 打印模板 / 打印模板；当前已注册页面或工作区子视图 | `frontend/src/pages/settings/print-templates/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:687 | 顶栏可见候选（按权限过滤） | 15 | loading:线索；empty:待核；error:线索；denied:待核；disabled:待核；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | A-template-read：读取400被旧UI画成空结果；非法模板详情受阻；F01/P1；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings/print-templates/:id` | 编辑打印模板 / 编辑打印模板；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/settings/print-templates/editor.tsx`；注册 frontend/src/router/routeDefinitions.ts:963 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 6 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings/print-templates/new` | 新建打印模板 / 新建打印模板；创建、录入与保存表面 | `frontend/src/pages/settings/print-templates/editor.tsx`；注册 frontend/src/router/routeDefinitions.ts:963 | 隐藏；无顶栏注册；按钮/来源跳转/直达 | 6 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | 尚未审查 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings/printers` | 打印机管理 / 打印机管理；当前已注册页面或工作区子视图 | `frontend/src/pages/settings/printers/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:696 | 顶栏可见候选（按权限过滤） | 18 | loading:线索；empty:线索；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F12/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## 系统设置

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `*` | 跳转 → / / 未知地址的路由回退；须独立验证，不作为可遍历业务页 | `frontend/src/router/index.tsx`；注册 frontend/src/router/index.tsx:130；→ / | 隐藏；公开/认证/回退入口 | 0 | loading:线索；empty:待核；error:待核；denied:待核；disabled:待核；success:待核；unknown:待核 | 未查看 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 未打开此业务调用表面；静态可达/共享测试/页面截图不能代替实际调用条件验收 |
| `/` | 官网入口 / 官网入口；当前已注册页面或工作区子视图 | `frontend/src/pages/landing/index.tsx`；注册 frontend/src/router/index.tsx:111 | 隐藏；公开/认证/回退入口 | 3 | loading:待核；empty:待核；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | 尚未审查 | 本源文件未修改 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/403` | 无访问权限 / 无访问权限；当前已注册页面或工作区子视图 | `frontend/src/pages/403/index.tsx`；注册 frontend/src/router/index.tsx:129 | 隐藏；公开/认证/回退入口 | 0 | loading:待核；empty:待核；error:待核；denied:线索；disabled:待核；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/departments` | 部门管理 / 部门管理；当前已注册页面或工作区子视图 | `frontend/src/pages/departments/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:734 | 顶栏可见候选（按权限过滤） | 19 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/login` | 系统登录 / 系统登录；当前已注册页面或工作区子视图 | `frontend/src/pages/login/index.tsx`；注册 frontend/src/router/index.tsx:115 | 隐藏；公开/认证/回退入口 | 0 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 真实未认证登录正常/错误/空密码禁用代表状态已查看；旧认证跳转截图保留 | 尚未审查 | 本源文件未修改 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 本批合成错误账号401、1024/768浅深代表态已验；未知结果、全部响应/原生认证/全键盘仍待指定证据 |
| `/oplogs` | 操作日志 / 操作日志；当前已注册页面或工作区子视图 | `frontend/src/pages/oplogs/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:779 | 顶栏可见候选（按权限过滤） | 20 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已查看入口布局总览；未等同于表单、子表面或全状态验收 | F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/permissions` | 权限管理 / 权限管理；当前已注册页面或工作区子视图 | `frontend/src/pages/permissions/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:752 | 顶栏可见候选（按权限过滤） | 17 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F12/P2；F15/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings` | 系统设置 / 系统设置；当前已注册页面或工作区子视图 | `frontend/src/pages/settings/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:770 | 顶栏可见候选（按权限过滤） | 5 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/settings/pda-devices` | PDA 设备 / PDA 设备；当前已注册页面或工作区子视图 | `frontend/src/pages/settings/pda-devices/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:761 | 顶栏可见候选（按权限过滤） | 21 | loading:线索；empty:待核；error:待核；denied:待核；disabled:线索；success:线索；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F09/P2；F13/P2；F15/P2；F17/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/users` | 用户管理 / 用户管理；当前已注册页面或工作区子视图 | `frontend/src/pages/users/index.tsx`；注册 frontend/src/router/routeDefinitions.ts:743 | 顶栏可见候选（按权限过滤） | 33 | loading:线索；empty:待核；error:线索；denied:线索；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F04/P1；F05/P1；F09/P2；F13/P2；F15/P2；F17/P2 | 共享依赖已修改；本用方仍须独立复验 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |

## PDA

| route | 页面 / 用途 | 源码入口 | 导航 | 子表面 | 状态线索 | 实际查看 | 问题 | 是否修改 | 验证 | 未覆盖原因 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/pda` | PDA 工作台 / PDA 工作台；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/index.tsx`；注册 frontend/src/router/pdaRoutes.tsx:68 | 隐藏；PDA 子作业/条件入口/直达 | 1 | loading:待核；empty:线索；error:待核；denied:线索；disabled:待核；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/adjustments` | 改单确认 / 改单确认；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/adjustment.tsx`；注册 frontend/src/router/pdaRoutes.tsx:96 | PDA 常用作业（按权限过滤） | 13 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已捕获；人工细看待核实 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/adjustments/:id` | 改单确认 / 改单确认；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/adjustment.tsx`；注册 frontend/src/router/pdaRoutes.tsx:97 | 隐藏；PDA 子作业/条件入口/直达 | 13 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |
| `/pda/bind` | 设备绑定 / 设备绑定；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/bind.tsx`；注册 frontend/src/router/pdaRoutes.tsx:90 | 隐藏；PDA 子作业/条件入口/直达 | 6 | loading:待核；empty:待核；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/cancel-return` | 拣货退回 / 拣货退回；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/cancel-return.tsx`；注册 frontend/src/router/pdaRoutes.tsx:94 | PDA 常用作业（按权限过滤） | 13 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已捕获；人工细看待核实 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/cancel-return/:id` | 拣货退回确认 / 拣货退回确认；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/cancel-return.tsx`；注册 frontend/src/router/pdaRoutes.tsx:95 | 隐藏；PDA 子作业/条件入口/直达 | 13 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |
| `/pda/check` | 复核作业 / 复核作业；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/check.tsx`；注册 frontend/src/router/pdaRoutes.tsx:76 | PDA 常用作业（按权限过滤） | 16 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已捕获；人工细看待核实 | F02/P1；F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/check/:id` | 复核作业 / 复核作业；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/check.tsx`；注册 frontend/src/router/pdaRoutes.tsx:75 | 隐藏；PDA 子作业/条件入口/直达 | 16 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F02/P1；F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/fill` | 塑料盒放货 / 塑料盒放货；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/fill.tsx`；注册 frontend/src/router/pdaRoutes.tsx:85 | 隐藏；PDA 子作业/条件入口/直达 | 3 | loading:待核；empty:待核；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/inbound` | 收货订单 / 收货订单；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/inbound.tsx`；注册 frontend/src/router/pdaRoutes.tsx:69 | PDA 常用作业（按权限过滤） | 6 | loading:线索；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已捕获；人工细看待核实 | 尚未审查 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/inventory-query` | 库存查询 / 库存查询；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/inventory-query.tsx`；注册 frontend/src/router/pdaRoutes.tsx:102 | PDA 更多功能（按权限过滤） | 3 | loading:待核；empty:待核；error:待核；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/login` | PDA 登录 / PDA 登录；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/login.tsx`；注册 frontend/src/router/pdaRoutes.tsx:59 | 隐藏；PDA 子作业/条件入口/直达 | 0 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 未查看 | 尚未审查 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 未打开此业务调用表面；静态可达/共享测试/页面截图不能代替实际调用条件验收 |
| `/pda/pack` | 打包作业 / 打包作业；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/pack.tsx`；注册 frontend/src/router/pdaRoutes.tsx:78 | PDA 常用作业（按权限过滤） | 21 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已捕获；人工细看待核实 | F02/P1；F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/pack/:id` | 打包作业 / 打包作业；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/pack.tsx`；注册 frontend/src/router/pdaRoutes.tsx:77 | 隐藏；PDA 子作业/条件入口/直达 | 21 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F02/P1；F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/picking` | 拣货任务 / 拣货任务；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/picking.tsx`；注册 frontend/src/router/pdaRoutes.tsx:73 | PDA 常用作业（按权限过滤） | 6 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F02/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/plastic-box` | 塑料盒作业 / 塑料盒作业；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/plastic-box.tsx`；注册 frontend/src/router/pdaRoutes.tsx:81 | PDA 更多功能（按权限过滤） | 9 | loading:线索；empty:待核；error:待核；denied:待核；disabled:线索；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/putaway` | 扫码上架 / 扫码上架；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/putaway.tsx`；注册 frontend/src/router/pdaRoutes.tsx:72 | PDA 常用作业（按权限过滤） | 19 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已捕获；人工细看待核实 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/putaway/:id` | 扫码上架 / 扫码上架；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/putaway.tsx`；注册 frontend/src/router/pdaRoutes.tsx:71 | 隐藏；PDA 子作业/条件入口/直达 | 19 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/receive/:id` | 收货登记 / 收货登记；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/receive.tsx`；注册 frontend/src/router/pdaRoutes.tsx:70 | 隐藏；PDA 子作业/条件入口/直达 | 14 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F02/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/sale-return` | 销售退货 / 销售退货；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/sale-return.tsx`；注册 frontend/src/router/pdaRoutes.tsx:103 | PDA 常用作业（按权限过滤） | 6 | loading:线索；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已捕获；人工细看待核实 | 尚未审查 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/sale-return/:id/putaway` | 退货上架 / 退货上架；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/sale-return-putaway.tsx`；注册 frontend/src/router/pdaRoutes.tsx:105 | 隐藏；PDA 子作业/条件入口/直达 | 11 | loading:线索；empty:待核；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |
| `/pda/sale-return/:id/receive` | 退货收货 / 退货收货；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/sale-return-receive.tsx`；注册 frontend/src/router/pdaRoutes.tsx:104 | 隐藏；PDA 子作业/条件入口/直达 | 11 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |
| `/pda/ship` | 出库确认 / 出库确认；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/ship.tsx`；注册 frontend/src/router/pdaRoutes.tsx:92 | PDA 常用作业（按权限过滤） | 9 | loading:线索；empty:线索；error:待核；denied:待核；disabled:线索；success:线索；unknown:线索 | 已捕获；人工细看待核实 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/ship/:id` | 出库确认 / 出库确认；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/ship.tsx`；注册 frontend/src/router/pdaRoutes.tsx:91 | 隐藏；PDA 子作业/条件入口/直达 | 9 | loading:线索；empty:线索；error:待核；denied:待核；disabled:线索；success:线索；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 已看指定ID地址的扫描初态，但ship源码不消费routeID；没有该任务详情/可执行阶段/真实出库流程验收。 |
| `/pda/sort` | 分拣作业 / 分拣作业；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/sort.tsx`；注册 frontend/src/router/pdaRoutes.tsx:93 | PDA 常用作业（按权限过滤） | 7 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/split` | 塑料盒作业 / 塑料盒作业；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/split.tsx`；注册 frontend/src/router/pdaRoutes.tsx:80 | 隐藏；PDA 子作业/条件入口/直达 | 5 | loading:待核；empty:待核；error:待核；denied:线索；disabled:线索；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/split-recovery` | 拆分结果核对 / 拆分结果核对；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/split-recovery.tsx`；注册 frontend/src/router/pdaRoutes.tsx:83 | 隐藏；PDA 子作业/条件入口/直达 | 3 | loading:待核；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F12/P2 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/stockcheck` | 扫码盘点 / 扫码盘点；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/stockcheck.tsx`；注册 frontend/src/router/pdaRoutes.tsx:87 | PDA 常用作业（按权限过滤） | 12 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 已捕获；人工细看待核实 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/stockcheck/:id` | 扫码盘点 / 扫码盘点；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/stockcheck.tsx`；注册 frontend/src/router/pdaRoutes.tsx:86 | 隐藏；PDA 子作业/条件入口/直达 | 12 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:待核 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |
| `/pda/task/:id` | 扫码拣货 / 扫码拣货；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/task.tsx`；注册 frontend/src/router/pdaRoutes.tsx:74 | 隐藏；PDA 子作业/条件入口/直达 | 10 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:线索；unknown:线索 | 已人工查看代表状态；具体阶段/条件见证据；未覆盖状态仍待验 | F02/P1；F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 已执行记录中的限定交互；未等同于业务提交或全页面验收；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/transfer` | 调拨执行 / 调拨执行；PDA 工作台、扫码作业或设备入口 | `frontend/src/pages/pda/transfer.tsx`；注册 frontend/src/router/pdaRoutes.tsx:98 | PDA 常用作业（按权限过滤） | 6 | loading:线索；empty:线索；error:线索；denied:待核；disabled:待核；success:待核；unknown:待核 | 已捕获；人工细看待核实 | 尚未审查 | 共享依赖已修改；本用方仍须独立复验 | 未执行；测试 未执行 | 证据只覆盖记录中的路径/状态；未开的弹窗抽屉选择器、七态、只读/撤权、迟到响应、其他尺寸/硬件仍待验 |
| `/pda/transfer-in/:id` | 调入仓扫码入库 / 调入仓扫码入库；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/transfer-in.tsx`；注册 frontend/src/router/pdaRoutes.tsx:100 | 隐藏；PDA 子作业/条件入口/直达 | 16 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |
| `/pda/transfer-out/:id` | 调出仓扫码出库 / 调出仓扫码出库；具体单据/记录详情、编辑或执行表面 | `frontend/src/pages/pda/transfer-out.tsx`；注册 frontend/src/router/pdaRoutes.tsx:99 | 隐藏；PDA 子作业/条件入口/直达 | 16 | loading:线索；empty:线索；error:线索；denied:待核；disabled:线索；success:待核；unknown:线索 | 未查看 | F06/P1；F12/P2 | 本调用源/页面源已修改；不等于验证通过 | 未执行；测试 未执行 | 动态详情尚缺明确具体合成资源、当前权限与合法阶段的实际读取证据；仍按各单据/任务ID及阶段验收。 |

## 弹窗、抽屉、选择器与状态表面实际调用点

以下按源文件调用点列出；同一封装的不同调用点保留，底层 Dialog 与上层业务 Dialog 也分别保留。relatedRoutes 是 import 可达候选，不表示已渲染。完整相关路径、参数、definitionStateRef、问题/修改/验证字段见 JSON。categories 保存全部候选用方分类；表中分类取首个候选方便定位，跨模块共享调用不代表该单一分类专用。

| 分类 | 表面 / 类型 | 实际调用点 | 用途 / 打开条件 | 候选用方 | 实际查看 / 验证 |
| --- | --- | --- | --- | ---: | --- |
| 审批待办 | Badge / 状态表面 | `frontend/src/components/dashboard/DashboardVersionCard.tsx:115` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/components/dashboard/WidgetShell.tsx:40` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/components/dashboard/widgets/ChartWidgets.tsx:116` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/components/dashboard/widgets/ChartWidgets.tsx:118` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | input / 选择器 | `frontend/src/components/dashboard/widgets/FunWidgets.tsx:195` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | input / 选择器 | `frontend/src/components/dashboard/widgets/FunWidgets.tsx:289` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/components/dashboard/widgets/OperationalWidgets.tsx:109` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/components/dashboard/widgets/OperationalWidgets.tsx:252` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/components/dashboard/widgets/PrioritySales.tsx:46` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | Dialog / 弹窗 | `frontend/src/components/dashboard/widgets/RiskDetails.tsx:47` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；true | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/components/dashboard/widgets/RiskDetails.tsx:66` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/components/desktop/DesktopUpdateBridge.tsx:42` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；update != null | 0；壳层候选 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/components/finder/CategoryFinder.tsx:149` → `frontend/src/components/shared/AppDialog.tsx` | <span className="flex items-center gap-2"><FolderTree className="h-4 w-4 text-primary" />选择分类</span>；open | 31 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/components/finder/CategoryFinder.tsx:168` → `frontend/src/components/shared/QueryErrorState.tsx` | 分类加载失败；由调用代码决定；需运行时触发 | 31 | 未查看 / 未执行 |
| 销售 | FinderModal / 弹窗 | `frontend/src/components/finder/CustomerFinder.tsx:92` → `frontend/src/components/finder/FinderModal.tsx` | <span className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />选择客户</span>；visible | 31 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/components/finder/FinderModal.tsx:50` → `frontend/src/components/shared/AppDialog.tsx` | title；open | 32 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/components/finder/FinderModal.tsx:75` → `frontend/src/components/shared/QueryErrorState.tsx` | 加载失败；由调用代码决定；需运行时触发 | 32 | 未查看 / 未执行 |
| 销售 | FinderTable / 表格状态 | `frontend/src/components/finder/FinderModal.tsx:77` → `frontend/src/components/finder/FinderTable.tsx` | FinderTable 当前实际调用表面；由调用代码决定；需运行时触发 | 32 | 未查看 / 未执行 |
| 销售 | FinderModal / 弹窗 | `frontend/src/components/finder/SupplierFinder.tsx:79` → `frontend/src/components/finder/FinderModal.tsx` | <span className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />选择供应商</span>；open | 31 | 未查看 / 未执行 |
| 系统设置 | nav / 导航/全局表面 | `frontend/src/components/layout/TopNav.tsx:268` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| PDA | Dialog.Overlay / 弹窗 | `frontend/src/components/pda/PdaDialog.tsx:15` | Dialog.Overlay 当前实际调用表面；由调用代码决定；需运行时触发 | 1；壳层候选 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/components/pda/PdaEmptyState.tsx:80` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaEmptyState 当前实际调用表面；由调用代码决定；需运行时触发 | 26 | 未查看 / 未执行 |
| PDA | PdaDialog / 弹窗 | `frontend/src/components/pda/PdaOverReceiveDialog.tsx:44` → `frontend/src/components/pda/PdaDialog.tsx` | 确认超收；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/components/pda/PdaRoutePermission.tsx:34` → `frontend/src/components/pda/PdaHeader.tsx` | title；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/components/pda/PdaRoutePermission.tsx:35` → `frontend/src/components/pda/PdaEmptyState.tsx` | 当前 PDA 未绑定设备；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/components/pda/PdaRoutePermission.tsx:49` → `frontend/src/components/pda/PdaHeader.tsx` | title；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/components/pda/PdaRoutePermission.tsx:50` → `frontend/src/components/pda/PdaEmptyState.tsx` | 暂时无法确认权限；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/components/pda/PdaRoutePermission.tsx:65` → `frontend/src/components/pda/PdaHeader.tsx` | title；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/components/pda/PdaRoutePermission.tsx:66` → `frontend/src/components/pda/PdaEmptyState.tsx` | 当前账号无权访问；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/components/pda/PdaTaskState.tsx:28` → `frontend/src/components/pda/PdaHeader.tsx` | title；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| PDA | PdaDialog / 弹窗 | `frontend/src/components/pda/PdaUpdateDialog.tsx:118` → `frontend/src/components/pda/PdaDialog.tsx` | `发现新版本 v${version.version}`；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 销售 | OrderPrintOverlay / 弹窗 | `frontend/src/components/print/SaleOrderPrintTemplate.tsx:22` → `frontend/src/components/print/OrderPrintOverlay.tsx` | order.orderNo；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/components/shared/AppDialog.tsx:176` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 67；壳层候选 | 未查看 / 未执行 |
| 销售 | DialogOverlay / 弹窗 | `frontend/src/components/shared/AppDialog.tsx:179` → `frontend/src/components/ui/dialog.tsx` | DialogOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 67；壳层候选 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/components/shared/BaseCrudPage.tsx:204` → `frontend/src/components/shared/QueryErrorState.tsx` | `${title}加载失败`；由调用代码决定；需运行时触发 | 8 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/components/shared/BaseCrudPage.tsx:204` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 8 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/components/shared/BaseCrudPage.tsx:207` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；formOpen | 8 | 未查看 / 未执行 |
| 库存仓储 | EditModeBadge / 状态表面 | `frontend/src/components/shared/BaseCrudPage.tsx:213` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 8 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/components/shared/BaseCrudPage.tsx:238` → `frontend/src/components/shared/ConfirmDialog.tsx` | 放弃未保存输入？；discardOpen | 8 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/components/shared/BaseCrudPage.tsx:249` → `frontend/src/components/shared/ConfirmDialog.tsx` | `删除${title.replace(/管理$/, '')}`；!!deleteTarget | 8 | 未查看 / 未执行 |
| 采购 | DropdownMenu / 浮层 | `frontend/src/components/shared/CategoryTreeSelect.tsx:137` → `frontend/src/components/ui/dropdown-menu.tsx` | DropdownMenu 当前实际调用表面；open | 3 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/components/shared/ConfirmDialog.tsx:94` → `frontend/src/components/shared/AppDialog.tsx` | <span className="flex items-center gap-2"> {variant === 'destructive' && ( <AlertTriangle className="h-4 w-4 text-destructive-ink" /> )} {title} </span>；open | 46；壳层候选 | 未查看 / 未执行 |
| 库存仓储 | Sheet / 抽屉 | `frontend/src/components/shared/ContainerDrawer.tsx:41` → `frontend/src/components/ui/sheet.tsx` | Sheet 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 库存仓储 | EmptyState / 状态表面 | `frontend/src/components/shared/ContainerDrawer.tsx:207` → `frontend/src/components/shared/EmptyState.tsx` | 暂无流转记录；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | nav / 导航/全局表面 | `frontend/src/components/shared/DailyWork.tsx:47` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/components/shared/DataTable.tsx:105` | rowSelectable ? undefined : '该行不可勾选'；由调用代码决定；需运行时触发 | 82 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/components/shared/DataTable.tsx:169` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 82 | 未查看 / 未执行 |
| 销售 | VirtualTableBody / 表格状态 | `frontend/src/components/shared/DataTable.tsx:245` → `frontend/src/components/shared/VirtualTableBody.tsx` | VirtualTableBody 当前实际调用表面；由调用代码决定；需运行时触发 | 82 | 未查看 / 未执行 |
| 销售 | Popover / 浮层 | `frontend/src/components/shared/DatePicker.tsx:66` → `frontend/src/components/ui/popover.tsx` | Popover 当前实际调用表面；open | 48 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/components/shared/DateRangeQueryBar.tsx:54` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/components/shared/DateRangeQueryBar.tsx:61` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/components/shared/DirtyGuardDialog.tsx:18` → `frontend/src/components/shared/ConfirmDialog.tsx` | 离开确认；pendingConfirm !== null | 0；壳层候选 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | EmptyState / 状态表面 | `frontend/src/components/shared/DocumentActivityPanel.tsx:29` → `frontend/src/components/shared/EmptyState.tsx` | 暂无操作记录；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | EmptyState / 状态表面 | `frontend/src/components/shared/DocumentActivityPanel.tsx:33` → `frontend/src/components/shared/EmptyState.tsx` | `暂无${s.title.includes('打印') ? '打印任务' : '作业明细'}`；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | Badge / 状态表面 | `frontend/src/components/shared/EditModeBadge.tsx:27` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 31 | 未查看 / 未执行 |
| 销售 | Badge / 状态表面 | `frontend/src/components/shared/EditModeBadge.tsx:46` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 31 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/components/shared/FulfillmentTodos.tsx:44` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 审批待办 | DataTable / 表格状态 | `frontend/src/components/shared/FulfillmentTodos.tsx:51` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/components/shared/GlobalConfirmDialog.tsx:52` → `frontend/src/components/shared/ConfirmDialog.tsx` | state.title；state.open | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | EmptyState / 状态表面 | `frontend/src/components/shared/GlobalSearch.tsx:137` → `frontend/src/components/shared/EmptyState.tsx` | `未找到「${query}」相关内容`；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | nav / 导航/全局表面 | `frontend/src/components/shared/MergedPage.tsx:44` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| 系统设置 | Popover / 浮层 | `frontend/src/components/shared/NotificationBell.tsx:67` → `frontend/src/components/ui/popover.tsx` | Popover 当前实际调用表面；open | 0；壳层候选 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/components/shared/OperatorSelectField.tsx:27` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 7 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/components/shared/OrderActivityDialog.tsx:23` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 2 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:168` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:186` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:187` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:191` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | select / 选择器 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:221` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | select / 选择器 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:224` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/components/shared/OrderFulfillmentPanel.tsx:225` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 23 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/components/shared/PaymentQueryDialog.tsx:141` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 4 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:175` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:189` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:222` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:226` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:228` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:237` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:239` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | SupplierFinder / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:266` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；partyFinderOpen | 4 | 未查看 / 未执行 |
| 财务会计 | CustomerFinder / 选择器 | `frontend/src/components/shared/PaymentQueryDialog.tsx:269` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；partyFinderOpen | 4 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/components/shared/ProcurementSupplyDetails.tsx:22` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 2 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 采购 | QueryErrorState / 状态表面 | `frontend/src/components/shared/ProcurementSupplyDetails.tsx:35` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | Select / 选择器 | `frontend/src/components/shared/ProcurementSupplyDetails.tsx:47` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/components/shared/ProductFinderModal.tsx:96` → `frontend/src/components/shared/AppDialog.tsx` | <span className="flex items-center gap-2"><PackageSearch className="h-4 w-4 text-primary" />选择商品</span>；readable | 33 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/components/shared/ProductFinderModal.tsx:114` → `frontend/src/components/shared/QueryErrorState.tsx` | 商品加载失败；由调用代码决定；需运行时触发 | 33 | 未查看 / 未执行 |
| 销售 | EmptyState / 状态表面 | `frontend/src/components/shared/QueryErrorState.tsx:75` → `frontend/src/components/shared/EmptyState.tsx` | title；由调用代码决定；需运行时触发 | 73 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/components/shared/ReceiptPanel.tsx:140` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | PaymentQueryDialog / 弹窗 | `frontend/src/components/shared/ReceiptPanel.tsx:142` → `frontend/src/components/shared/PaymentQueryDialog.tsx` | PaymentQueryDialog 当前实际调用表面；queryOpen | 4 | 未查看 / 未执行 |
| 财务会计 | SettleReceiptDialog / 弹窗 | `frontend/src/components/shared/ReceiptPanel.tsx:152` → `frontend/src/components/shared/payments/SettleReceiptDialog.tsx` | SettleReceiptDialog 当前实际调用表面；formOpen | 4 | 未查看 / 未执行 |
| 财务会计 | ReceiptDetailDialog / 弹窗 | `frontend/src/components/shared/ReceiptPanel.tsx:162` → `frontend/src/components/shared/payments/ReceiptDetailDialog.tsx` | ReceiptDetailDialog 当前实际调用表面；detailId != null | 4 | 未查看 / 未执行 |
| 库存仓储 | EmptyState / 状态表面 | `frontend/src/components/shared/ReportPanel.tsx:47` → `frontend/src/components/shared/EmptyState.tsx` | emptyTitle；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 基础资料 | Select / 选择器 | `frontend/src/components/shared/SettlementTypeField.tsx:52` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | Select / 选择器 | `frontend/src/components/shared/SettlementTypeField.tsx:66` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/components/shared/ShippingProductField.tsx:11` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/components/shared/StatementPanel.tsx:159` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | PaymentQueryDialog / 弹窗 | `frontend/src/components/shared/StatementPanel.tsx:161` → `frontend/src/components/shared/PaymentQueryDialog.tsx` | PaymentQueryDialog 当前实际调用表面；queryOpen | 2 | 未查看 / 未执行 |
| 财务会计 | CreateStatementDialog / 弹窗 | `frontend/src/components/shared/StatementPanel.tsx:171` → `frontend/src/components/shared/payments/CreateStatementDialog.tsx` | CreateStatementDialog 当前实际调用表面；createOpen | 2 | 未查看 / 未执行 |
| 财务会计 | StatementDetailDialog / 弹窗 | `frontend/src/components/shared/StatementPanel.tsx:179` → `frontend/src/components/shared/payments/StatementDetailDialog.tsx` | StatementDetailDialog 当前实际调用表面；detailId != null | 2 | 未查看 / 未执行 |
| 销售 | Badge / 状态表面 | `frontend/src/components/shared/StatusBadge.tsx:92` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 92；壳层候选 | 未查看 / 未执行 |
| 销售 | Badge / 状态表面 | `frontend/src/components/shared/StatusBadge.tsx:116` → `frontend/src/components/ui/badge.tsx` | title；由调用代码决定；需运行时触发 | 92；壳层候选 | 未查看 / 未执行 |
| 销售 | DropdownMenu / 浮层 | `frontend/src/components/shared/TableActionsMenu.tsx:101` → `frontend/src/components/ui/dropdown-menu.tsx` | DropdownMenu 当前实际调用表面；由调用代码决定；需运行时触发 | 30 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/components/shared/UserMenu.tsx:137` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；infoOpen | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/components/shared/UserMenu.tsx:179` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；logoutOpen | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/components/shared/UserMenu.tsx:205` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；pwdOpen | 0；壳层候选 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/components/shared/WarehouseSelect.tsx:36` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 28 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/components/shared/payments/BackfillRequestDialog.tsx:40` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 6 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/CreateManualPayableDialog.tsx:192` → `frontend/src/components/shared/AppDialog.tsx` | 新建应付账款（无单据）；open | 2 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/payments/CreateManualPayableDialog.tsx:237` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/payments/CreateManualPayableDialog.tsx:255` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/payments/CreateManualPayableDialog.tsx:259` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/CreateStatementDialog.tsx:79` → `frontend/src/components/shared/AppDialog.tsx` | 新建对账单；open | 2 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/payments/CreateStatementDialog.tsx:103` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/payments/CreateStatementDialog.tsx:104` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | input / 选择器 | `frontend/src/components/shared/payments/CreateStatementDialog.tsx:134` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/ReceiptDetailDialog.tsx:46` → `frontend/src/components/shared/AppDialog.tsx` | <>核销明细 — <span className="text-doc-code-strong">{detail?.receiptNo}</span></>；open | 4 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/components/shared/payments/ReceiptDetailDialog.tsx:62` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/components/shared/payments/ReceiptDetailDialog.tsx:74` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:141` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 账户余额不足；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:155` → `frontend/src/components/shared/AppDialog.tsx` | actionLabel；open | 2 | 未查看 / 未执行 |
| 财务会计 | UncertainSubmitNotice / 状态表面 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:172` → `frontend/src/components/shared/payments/UncertainSubmitNotice.tsx` | UncertainSubmitNotice 当前实际调用表面；guard.uncertain | 2 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:198` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:208` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:210` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | BackfillRequestDialog / 弹窗 | `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx:225` → `frontend/src/components/shared/payments/BackfillRequestDialog.tsx` | BackfillRequestDialog 当前实际调用表面；!!prompt | 2 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:245` → `frontend/src/components/shared/AppDialog.tsx` | isContinue ? `继续核销 — ${receipt?.receiptNo}` : `登记${actionLabel}并核销`；open | 4 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:263` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 账户余额不足；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | UncertainSubmitNotice / 状态表面 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:280` → `frontend/src/components/shared/payments/UncertainSubmitNotice.tsx` | UncertainSubmitNotice 当前实际调用表面；guard.uncertain | 4 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:326` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:334` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:343` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 财务会计 | CustomerFinder / 选择器 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:420` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；finderOpen | 4 | 未查看 / 未执行 |
| 财务会计 | SupplierFinder / 选择器 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:421` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；finderOpen | 4 | 未查看 / 未执行 |
| 财务会计 | BackfillRequestDialog / 弹窗 | `frontend/src/components/shared/payments/SettleReceiptDialog.tsx:423` → `frontend/src/components/shared/payments/BackfillRequestDialog.tsx` | BackfillRequestDialog 当前实际调用表面；!!prompt | 4 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/SettlementConfirmDialog.tsx:40` → `frontend/src/components/shared/AppDialog.tsx` | <>应付结算确认 — <span className="text-doc-code-strong">{record?.orderNo}</span></>；open | 4 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/components/shared/payments/StatementDetailDialog.tsx:59` → `frontend/src/components/shared/AppDialog.tsx` | <>对账单 — <span className="text-doc-code-strong">{detail?.statementNo}</span></>；open | 2 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/components/shared/payments/StatementDetailDialog.tsx:81` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/components/shared/payments/StatementDetailDialog.tsx:93` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | RegisterPaymentDialog / 弹窗 | `frontend/src/components/shared/usePaymentActions.tsx:68` → `frontend/src/components/shared/payments/RegisterPaymentDialog.tsx` | RegisterPaymentDialog 当前实际调用表面；payOpen | 2 | 未查看 / 未执行 |
| 财务会计 | SettlementConfirmDialog / 弹窗 | `frontend/src/components/shared/usePaymentActions.tsx:77` → `frontend/src/components/shared/payments/SettlementConfirmDialog.tsx` | SettlementConfirmDialog 当前实际调用表面；confirmOpen | 2 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/components/shared/usePaymentActions.tsx:85` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；entriesOpen | 2 | 未查看 / 未执行 |
| 财务会计 | EmptyState / 状态表面 | `frontend/src/components/shared/usePaymentActions.tsx:88` → `frontend/src/components/shared/EmptyState.tsx` | 暂无流水记录；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | DayPicker / 选择器 | `frontend/src/components/ui/calendar.tsx:19` → `—` | DayPicker 当前实际调用表面；由调用代码决定；需运行时触发 | 48 | 未查看 / 未执行 |
| 销售 | DialogPrimitive.Overlay / 弹窗 | `frontend/src/components/ui/dialog.tsx:24` | DialogPrimitive.Overlay 当前实际调用表面；由调用代码决定；需运行时触发 | 82；壳层候选 | 未查看 / 未执行 |
| 销售 | DialogOverlay / 弹窗 | `frontend/src/components/ui/dialog.tsx:42` → `frontend/src/components/ui/dialog.tsx` | DialogOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 82；壳层候选 | 未查看 / 未执行 |
| 库存仓储 | SheetPrimitive.Overlay / 抽屉 | `frontend/src/components/ui/sheet.tsx:26` | SheetPrimitive.Overlay 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | SheetOverlay / 抽屉 | `frontend/src/components/ui/sheet.tsx:65` → `frontend/src/components/ui/sheet.tsx` | SheetOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | confirmAction / 命令式确认弹窗 | `frontend/src/hooks/useSale.ts:74` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 客户授信额度不足；由调用代码决定；需运行时触发 | 5 | 未查看 / 未执行 |
| 系统设置 | TopNav / 导航/全局表面 | `frontend/src/layouts/AppLayout.tsx:37` → `frontend/src/components/layout/TopNav.tsx` | TopNav 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | GlobalSearch / 导航/全局表面 | `frontend/src/layouts/AppLayout.tsx:41` → `frontend/src/components/shared/GlobalSearch.tsx` | GlobalSearch 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | NotificationBell / 导航/全局表面 | `frontend/src/layouts/AppLayout.tsx:42` → `frontend/src/components/shared/NotificationBell.tsx` | NotificationBell 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | UserMenu / 导航/全局表面 | `frontend/src/layouts/AppLayout.tsx:43` → `frontend/src/components/shared/UserMenu.tsx` | UserMenu 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | WorkspaceTabs / 导航/全局表面 | `frontend/src/layouts/AppLayout.tsx:48` → `frontend/src/components/layout/WorkspaceTabs.tsx` | WorkspaceTabs 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 系统设置 | TabErrorBoundary / 状态表面 | `frontend/src/layouts/AppLayout.tsx:53` → `frontend/src/components/shared/TabErrorBoundary.tsx` | TabErrorBoundary 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | KeepAliveOutlet / 导航/全局表面 | `frontend/src/layouts/AppLayout.tsx:54` → `frontend/src/components/layout/KeepAliveOutlet.tsx` | KeepAliveOutlet 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | DirtyGuardDialog / 弹窗 | `frontend/src/layouts/AppLayout.tsx:58` → `frontend/src/components/shared/DirtyGuardDialog.tsx` | DirtyGuardDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | GlobalConfirmDialog / 弹窗 | `frontend/src/layouts/AppLayout.tsx:59` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | GlobalConfirmDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 系统设置 | AppToast / 状态表面 | `frontend/src/layouts/AppLayout.tsx:60` → `frontend/src/components/shared/AppToast.tsx` | AppToast 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| PDA | PdaNetworkBar / 状态表面 | `frontend/src/layouts/PdaLayout.tsx:86` → `frontend/src/components/pda/PdaNetworkBar.tsx` | PdaNetworkBar 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| PDA | PdaErrorBoundary / 状态表面 | `frontend/src/layouts/PdaLayout.tsx:87` → `frontend/src/components/pda/PdaErrorBoundary.tsx` | PdaErrorBoundary 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| PDA | AppToast / 状态表面 | `frontend/src/layouts/PdaLayout.tsx:91` → `frontend/src/components/shared/AppToast.tsx` | AppToast 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| PDA | PdaUpdateDialog / 弹窗 | `frontend/src/layouts/PdaLayout.tsx:92` → `frontend/src/components/pda/PdaUpdateDialog.tsx` | PdaUpdateDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |
| 采购 | store.showConfirm / 命令式确认弹窗 | `frontend/src/lib/unsavedChanges.ts:30` | message；由调用代码决定；需运行时触发 | 3；壳层候选 | 未查看 / 未执行 |
| 系统设置 | GlobalErrorBoundary / 状态表面 | `frontend/src/main.tsx:102` | GlobalErrorBoundary 当前实际调用表面；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/accounts/index.tsx:130` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/accounts/index.tsx:171` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/accounts/index.tsx:186` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | input / 选择器 | `frontend/src/pages/accounting/accounts/index.tsx:209` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | EmptyState / 状态表面 | `frontend/src/pages/accounting/accounts/index.tsx:419` → `frontend/src/components/shared/EmptyState.tsx` | 暂无科目；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | AccountFormDialog / 弹窗 | `frontend/src/pages/accounting/accounts/index.tsx:447` → `frontend/src/pages/accounting/accounts/index.tsx` | AccountFormDialog 当前实际调用表面；formOpen | 1 | 未查看 / 未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/accounts/index.tsx:455` → `frontend/src/components/shared/ConfirmDialog.tsx` | `删除科目「${deleteTarget?.code} ${deleteTarget?.name}」`；!!deleteTarget | 1 | 未查看 / 未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/accounts/index.tsx:466` → `frontend/src/components/shared/ConfirmDialog.tsx` | `${toggleTarget?.isActive ? '停用' : '启用'}科目「${toggleTarget?.code} ${toggleTarget?.name}」`；!!toggleTarget | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:313` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && visible | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/backfills/index.tsx:526` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/backfills/index.tsx:533` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/backfills/index.tsx:557` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:563` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；targetOpen(detailRow) | 1 | 未查看 / 未执行 |
| 财务会计 | RemarkDialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:620` → `frontend/src/pages/accounting/backfills/index.tsx` | `批准并记账「${targetNo(approveTarget) ?? ''}」`；!!approveTarget | 1 | 未查看 / 未执行 |
| 财务会计 | RemarkDialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:647` → `frontend/src/pages/accounting/backfills/index.tsx` | `驳回「${targetNo(rejectTarget) ?? ''}」`；!!rejectTarget | 1 | 未查看 / 未执行 |
| 财务会计 | RemarkDialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:666` → `frontend/src/pages/accounting/backfills/index.tsx` | cancelTarget?.status === 0 ? `撤回「${targetNo(cancelTarget) ?? ''}」` : `作废「${targetNo(cancelTarget) ?? ''}」`；!!cancelTarget | 1 | 未查看 / 未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:689` → `frontend/src/components/shared/ConfirmDialog.tsx` | `重试记账「${targetNo(executeTarget) ?? ''}」`；targetOpen(executeTarget) | 1 | 未查看 / 未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/backfills/index.tsx:706` → `frontend/src/components/shared/ConfirmDialog.tsx` | `重新生成调整凭证「${targetNo(regenTarget) ?? ''}」`；targetOpen(regenTarget) | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/accounting/consolidation/index.tsx:28` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | useDirtyGuardStore.getState().showConfirm / 命令式确认弹窗 | `frontend/src/pages/accounting/consolidation/index.tsx:101` | 切换账套将关闭会计页面中的未保存编辑，确定切换吗？；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/consolidation/index.tsx:122` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/consolidation/index.tsx:157` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；createOpen | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/invoices/index.tsx:114` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | EditModeBadge / 状态表面 | `frontend/src/pages/accounting/invoices/index.tsx:120` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | UnsavedBadge / 状态表面 | `frontend/src/pages/accounting/invoices/index.tsx:121` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/invoices/index.tsx:147` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/accounting/invoices/index.tsx:157` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/invoices/index.tsx:167` → `frontend/src/components/shared/ConfirmDialog.tsx` | ConfirmDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/accounting/invoices/index.tsx:238` → `frontend/src/components/shared/QueryErrorState.tsx` | 发票列表加载失败；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/invoices/index.tsx:240` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | InvoiceDialog / 弹窗 | `frontend/src/pages/accounting/invoices/index.tsx:246` → `frontend/src/pages/accounting/invoices/index.tsx` | InvoiceDialog 当前实际调用表面；dialogOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/invoices/index.tsx:247` → `frontend/src/components/shared/ConfirmDialog.tsx` | `删除发票「${deleteTarget?.invoiceNo}」`；!!deleteTarget | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/ledger/index.tsx:27` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!accountId | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/accounting/ledger/index.tsx:32` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/accounting/ledger/index.tsx:95` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | LedgerDialog / 弹窗 | `frontend/src/pages/accounting/ledger/index.tsx:153` → `frontend/src/pages/accounting/ledger/index.tsx` | LedgerDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | confirm / 命令式确认弹窗 | `frontend/src/pages/accounting/periods/index.tsx:63` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 反结账；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/periods/index.tsx:128` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/periods/index.tsx:131` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!generating | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/periods/index.tsx:146` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!closing | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/accounting/reports/index.tsx:33` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/accounting/reports/index.tsx:62` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/tax/index.tsx:117` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/tax/index.tsx:143` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/VoucherQueryDialog.tsx:38` → `frontend/src/components/shared/AppDialog.tsx` | 查询记账凭证；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/vouchers/VoucherQueryDialog.tsx:72` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/vouchers/VoucherQueryDialog.tsx:83` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/accounting/vouchers/index.tsx:61` → `frontend/src/components/shared/QueryErrorState.tsx` | 勾稽核对加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:156` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | input / 选择器 | `frontend/src/pages/accounting/vouchers/index.tsx:169` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:188` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!id | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/accounting/vouchers/index.tsx:197` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/accounting/vouchers/index.tsx:208` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:274` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/accounting/vouchers/index.tsx:281` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/vouchers/index.tsx:292` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/accounting/vouchers/index.tsx:298` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DropdownMenu / 浮层 | `frontend/src/pages/accounting/vouchers/index.tsx:429` → `frontend/src/components/ui/dropdown-menu.tsx` | DropdownMenu 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/accounting/vouchers/index.tsx:463` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/accounting/vouchers/index.tsx:463` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | GenerateDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:468` → `frontend/src/pages/accounting/vouchers/index.tsx` | GenerateDialog 当前实际调用表面；genOpen | 1 | 未查看 / 未执行 |
| 财务会计 | ManualDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:469` → `frontend/src/pages/accounting/vouchers/index.tsx` | ManualDialog 当前实际调用表面；manualOpen | 1 | 未查看 / 未执行 |
| 财务会计 | DetailDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:470` → `frontend/src/pages/accounting/vouchers/index.tsx` | DetailDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | VoucherQueryDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:472` → `frontend/src/pages/accounting/vouchers/VoucherQueryDialog.tsx` | VoucherQueryDialog 当前实际调用表面；queryOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:479` → `frontend/src/components/shared/ConfirmDialog.tsx` | `冲销凭证「${reverseTarget?.voucherNo}」`；!!reverseTarget | 1 | 未查看 / 未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/accounting/vouchers/index.tsx:488` → `frontend/src/components/shared/ConfirmDialog.tsx` | `删除手工凭证「${deleteTarget?.voucherNo}」`；!!deleteTarget | 1 | 未查看 / 未执行 |
| 审批待办 | DataTable / 表格状态 | `frontend/src/pages/approvals/flows.tsx:196` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | Dialog / 弹窗 | `frontend/src/pages/approvals/flows.tsx:198` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；formOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 审批待办 | EditModeBadge / 状态表面 | `frontend/src/pages/approvals/flows.tsx:204` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | UnsavedBadge / 状态表面 | `frontend/src/pages/approvals/flows.tsx:205` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/pages/approvals/flows.tsx:217` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/pages/approvals/flows.tsx:259` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/pages/approvals/flows.tsx:273` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/pages/approvals/flows.tsx:283` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | select / 选择器 | `frontend/src/pages/approvals/flows.tsx:292` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | input / 选择器 | `frontend/src/pages/approvals/flows.tsx:310` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | ConfirmDialog / 弹窗 | `frontend/src/pages/approvals/flows.tsx:321` → `frontend/src/components/shared/ConfirmDialog.tsx` | ConfirmDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | ConfirmDialog / 弹窗 | `frontend/src/pages/approvals/flows.tsx:322` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除；!!deleteTarget | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/pages/approvals/pending.tsx:101` → `frontend/src/components/shared/QueryErrorState.tsx` | 审批待办读取失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | DataTable / 表格状态 | `frontend/src/pages/approvals/pending.tsx:102` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | nav / 导航/全局表面 | `frontend/src/pages/approvals/pending.tsx:111` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | EditModeBadge / 状态表面 | `frontend/src/pages/carrier-accounts/AccountBindingForm.tsx:68` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | UnsavedBadge / 状态表面 | `frontend/src/pages/carrier-accounts/AccountBindingForm.tsx:69` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carrier-accounts/AccountBindingForm.tsx:77` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carrier-accounts/AccountBindingForm.tsx:83` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | ConfirmDialog / 弹窗 | `frontend/src/pages/carrier-accounts/AccountBindingForm.tsx:123` → `frontend/src/components/shared/ConfirmDialog.tsx` | 解绑月结账号；confirmUnbind | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carrier-accounts/NewAccountForm.tsx:28` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carrier-accounts/index.tsx:110` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | ConfirmDialog / 弹窗 | `frontend/src/pages/carrier-accounts/index.tsx:115` → `frontend/src/components/shared/ConfirmDialog.tsx` | 放弃尚未保存的资料？；nextSelection !== null | 1 | 未查看 / 未执行 |
| 打印物流 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/carriers/index.tsx:86` → `frontend/src/components/shared/BaseCrudPage.tsx` | 承运商管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carriers/index.tsx:127` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carriers/index.tsx:142` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carriers/index.tsx:163` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/carriers/index.tsx:189` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | Dialog / 弹窗 | `frontend/src/pages/categories/index.tsx:114` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 基础资料 | EditModeBadge / 状态表面 | `frontend/src/pages/categories/index.tsx:122` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/categories/index.tsx:160` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | EmptyState / 状态表面 | `frontend/src/pages/categories/index.tsx:419` → `frontend/src/components/shared/EmptyState.tsx` | 暂无分类；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | CategoryFormDialog / 弹窗 | `frontend/src/pages/categories/index.tsx:447` → `frontend/src/pages/categories/index.tsx` | CategoryFormDialog 当前实际调用表面；formOpen | 1 | 未查看 / 未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/categories/index.tsx:456` → `frontend/src/components/shared/ConfirmDialog.tsx` | `删除分类「${deleteTarget?.name}」`；!!deleteTarget | 1 | 未查看 / 未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/categories/index.tsx:468` → `frontend/src/components/shared/ConfirmDialog.tsx` | `${toggleTarget?.status ? '停用' : '启用'}分类「${toggleTarget?.name}」`；!!toggleTarget | 1 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/pages/credit-overrides/CreditOverrideQueryDialog.tsx:43` → `frontend/src/components/shared/AppDialog.tsx` | 查询超额放行申请；open | 1 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/pages/credit-overrides/CreditOverrideQueryDialog.tsx:77` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/pages/credit-overrides/CreditOverrideQueryDialog.tsx:88` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/pages/credit-overrides/CreditOverrideQueryDialog.tsx:93` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/pages/credit-overrides/index.tsx:58` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/credit-overrides/index.tsx:81` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | EmptyState / 状态表面 | `frontend/src/pages/credit-overrides/index.tsx:93` → `frontend/src/components/shared/EmptyState.tsx` | 未找到草稿状态的销售单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | OrderActivityDialog / 弹窗 | `frontend/src/pages/credit-overrides/index.tsx:213` → `frontend/src/components/shared/OrderActivityDialog.tsx` | row.overrideNo；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/credit-overrides/index.tsx:221` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 取消申请；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/pages/credit-overrides/index.tsx:260` → `frontend/src/components/shared/QueryErrorState.tsx` | 加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/credit-overrides/index.tsx:262` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | ApprovalHandoffNotice / 状态表面 | `frontend/src/pages/credit-overrides/index.tsx:266` → `frontend/src/components/shared/ApprovalHandoffNotice.tsx` | ApprovalHandoffNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | OrderActivityDialog / 弹窗 | `frontend/src/pages/credit-overrides/index.tsx:267` → `frontend/src/components/shared/OrderActivityDialog.tsx` | handoff.data.overrideNo；handoff.open | 1 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/pages/credit-overrides/index.tsx:270` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!rejectTarget | 1 | 未查看 / 未执行 |
| 销售 | CreateDialog / 弹窗 | `frontend/src/pages/credit-overrides/index.tsx:286` → `frontend/src/pages/credit-overrides/index.tsx` | CreateDialog 当前实际调用表面；createOpen | 1 | 未查看 / 未执行 |
| 销售 | CreditOverrideQueryDialog / 弹窗 | `frontend/src/pages/credit-overrides/index.tsx:288` → `frontend/src/pages/credit-overrides/CreditOverrideQueryDialog.tsx` | CreditOverrideQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 基础资料 | Dialog / 弹窗 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:88` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 基础资料 | EditModeBadge / 状态表面 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:94` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | UnsavedBadge / 状态表面 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:95` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | SettlementTypeField / 选择器 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:139` → `frontend/src/components/shared/SettlementTypeField.tsx` | SettlementTypeField 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:148` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:164` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/customers/components/CustomerFormDialog.tsx:179` → `frontend/src/components/shared/ConfirmDialog.tsx` | ConfirmDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/customers/index.tsx:141` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | QueryErrorState / 状态表面 | `frontend/src/pages/customers/index.tsx:160` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 基础资料 | DataTable / 表格状态 | `frontend/src/pages/customers/index.tsx:160` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | CustomerFormDialog / 弹窗 | `frontend/src/pages/customers/index.tsx:165` → `frontend/src/pages/customers/components/CustomerFormDialog.tsx` | CustomerFormDialog 当前实际调用表面；dialogOpen && (editing ? canUpdate : can(PERMISSIONS.CUSTOMER_CREATE)) | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/customers/index.tsx:166` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除；!!confirmTarget && canDelete | 1 | 未查看 / 未执行 |
| 基础资料 | Dialog / 弹窗 | `frontend/src/pages/customers/index.tsx:177` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；bindOpen && canBindPrice | 1 | 未查看 / 未执行 |
| 基础资料 | Select / 选择器 | `frontend/src/pages/customers/index.tsx:183` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | QueryErrorState / 状态表面 | `frontend/src/pages/departments/index.tsx:337` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | DataTable / 表格状态 | `frontend/src/pages/departments/index.tsx:339` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/departments/index.tsx:348` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；formOpen | 1 | 未查看 / 未执行 |
| 系统设置 | EditModeBadge / 状态表面 | `frontend/src/pages/departments/index.tsx:354` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Select / 选择器 | `frontend/src/pages/departments/index.tsx:371` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Select / 选择器 | `frontend/src/pages/departments/index.tsx:385` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/pages/departments/index.tsx:418` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除；!!deleteTarget | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/disposal/ConversionDialog.tsx:44` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW) | 1 | 未查看 / 未执行 |
| 库存仓储 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/disposal/ConversionDialog.tsx:48` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/disposal/DisposalQueryDialog.tsx:46` → `frontend/src/components/shared/AppDialog.tsx` | 查询处置单；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/disposal/DisposalQueryDialog.tsx:80` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/disposal/DisposalQueryDialog.tsx:91` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/disposal/DisposalQueryDialog.tsx:103` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/disposal/DisposalQueryDialog.tsx:108` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DisposalExecutionPanel / 状态表面 | `frontend/src/pages/disposal/DisposalRecoveryPage.tsx:29` → `frontend/src/pages/disposal/DisposalExecutionPanel.tsx` | DisposalExecutionPanel 当前实际调用表面；active | 1 | 未查看 / 未执行 |
| 库存仓储 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/disposal/DisposalRecoveryPage.tsx:42` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/disposal/HandlingIntentDialog.tsx:39` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW) | 1 | 未查看 / 未执行 |
| 库存仓储 | select / 选择器 | `frontend/src/pages/disposal/HandlingIntentDialog.tsx:42` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | select / 选择器 | `frontend/src/pages/disposal/HandlingIntentDialog.tsx:43` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/disposal/HandlingIntentDialog.tsx:45` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/disposal/HandlingIntentDialog.tsx:50` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finder | 1 | 未查看 / 未执行 |
| 库存仓储 | CreateDisposalDialog / 弹窗 | `frontend/src/pages/disposal/HandlingScrapPage.tsx:17` → `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx` | CreateDisposalDialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/disposal/HandlingSourcesPanel.tsx:40` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW) | 1 | 未查看 / 未执行 |
| 库存仓储 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/disposal/HandlingSourcesPanel.tsx:40` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ReleaseDialog / 弹窗 | `frontend/src/pages/disposal/HandlingSourcesPanel.tsx:65` → `frontend/src/pages/disposal/HandlingSourcesPanel.tsx` | ReleaseDialog 当前实际调用表面；selected === key && handlingOwnerCurrent(draft.owner) | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx:132` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && (!handling \|\| (handling.source.current && handling.source.active)) | 2 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx:147` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | input / 选择器 | `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx:181` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx:210` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:88` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 库存仓储 | DisposalExecutionPanel / 状态表面 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:100` → `frontend/src/pages/disposal/DisposalExecutionPanel.tsx` | DisposalExecutionPanel 当前实际调用表面；readable && !actionsDisabled | 1 | 未查看 / 未执行 |
| 库存仓储 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:144` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 提交审批；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:153` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 审批通过；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:164` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 执行报废；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:177` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 取消处置单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx:190` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；rejectOpen && readable && status === 2 && can(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE) | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/disposal/index.tsx:146` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ApprovalHandoffNotice / 状态表面 | `frontend/src/pages/disposal/index.tsx:149` → `frontend/src/components/shared/ApprovalHandoffNotice.tsx` | ApprovalHandoffNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DisposalDetailDialog / 弹窗 | `frontend/src/pages/disposal/index.tsx:150` → `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx` | DisposalDetailDialog 当前实际调用表面；handoff.open | 1 | 未查看 / 未执行 |
| 库存仓储 | CreateDisposalDialog / 弹窗 | `frontend/src/pages/disposal/index.tsx:151` → `frontend/src/pages/disposal/components/CreateDisposalDialog.tsx` | CreateDisposalDialog 当前实际调用表面；createOpen \|\| suggestionOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | HandlingIntentDialog / 弹窗 | `frontend/src/pages/disposal/index.tsx:152` → `frontend/src/pages/disposal/HandlingIntentDialog.tsx` | HandlingIntentDialog 当前实际调用表面；intentOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | ConversionDialog / 弹窗 | `frontend/src/pages/disposal/index.tsx:153` → `frontend/src/pages/disposal/ConversionDialog.tsx` | ConversionDialog 当前实际调用表面；conversionId === id | 1 | 未查看 / 未执行 |
| 库存仓储 | DisposalDetailDialog / 弹窗 | `frontend/src/pages/disposal/index.tsx:154` → `frontend/src/pages/disposal/components/DisposalDetailDialog.tsx` | DisposalDetailDialog 当前实际调用表面；!!detailId | 1 | 未查看 / 未执行 |
| 库存仓储 | DisposalQueryDialog / 弹窗 | `frontend/src/pages/disposal/index.tsx:155` → `frontend/src/pages/disposal/DisposalQueryDialog.tsx` | DisposalQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/accounts/index.tsx:52` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/accounts/index.tsx:64` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/accounts/index.tsx:74` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/finance/accounts/index.tsx:241` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | AccountsQueryDialog / 弹窗 | `frontend/src/pages/finance/accounts/index.tsx:243` → `frontend/src/pages/finance/accounts/index.tsx` | AccountsQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/accounts/index.tsx:246` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；formOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | EditModeBadge / 状态表面 | `frontend/src/pages/finance/accounts/index.tsx:252` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/accounts/index.tsx:267` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | input / 选择器 | `frontend/src/pages/finance/accounts/index.tsx:298` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/accounts/index.tsx:314` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!txAccount | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/finance/accounts/index.tsx:327` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/accounts/index.tsx:362` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!adjustTarget | 1 | 未查看 / 未执行 |
| 财务会计 | ConfirmDialog / 弹窗 | `frontend/src/pages/finance/accounts/index.tsx:401` → `frontend/src/components/shared/ConfirmDialog.tsx` | 删除账户；!!deleteTarget | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/dashboard/index.tsx:220` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/dashboard/index.tsx:222` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/finance/dashboard/index.tsx:226` → `frontend/src/components/shared/QueryErrorState.tsx` | 资金数据加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/finance/expense-categories/index.tsx:33` → `frontend/src/components/shared/BaseCrudPage.tsx` | 费用类别；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | input / 选择器 | `frontend/src/pages/finance/expense-categories/index.tsx:64` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:63` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/expenses/index.tsx:75` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/expenses/index.tsx:87` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/expenses/index.tsx:89` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/finance/expenses/index.tsx:342` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ExpensesQueryDialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:346` → `frontend/src/pages/finance/expenses/index.tsx` | ExpensesQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:349` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；formOpen | 1 | 未查看 / 未执行 |
| 财务会计 | EditModeBadge / 状态表面 | `frontend/src/pages/finance/expenses/index.tsx:355` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/expenses/index.tsx:385` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/expenses/index.tsx:397` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ApprovalHandoffNotice / 状态表面 | `frontend/src/pages/finance/expenses/index.tsx:424` → `frontend/src/components/shared/ApprovalHandoffNotice.tsx` | ApprovalHandoffNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:426` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；shownDetailId != null | 1 | 未查看 / 未执行 |
| 财务会计 | ReportTable / 表格状态 | `frontend/src/pages/finance/expenses/index.tsx:446` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:473` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!payTarget | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/expenses/index.tsx:482` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/finance/expenses/index.tsx:497` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 账户余额不足；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | UncertainSubmitNotice / 状态表面 | `frontend/src/pages/finance/expenses/index.tsx:515` → `frontend/src/components/shared/payments/UncertainSubmitNotice.tsx` | UncertainSubmitNotice 当前实际调用表面；guard.uncertain | 1 | 未查看 / 未执行 |
| 财务会计 | BackfillRequestDialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:527` → `frontend/src/components/shared/payments/BackfillRequestDialog.tsx` | BackfillRequestDialog 当前实际调用表面；!!prompt | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/expenses/index.tsx:537` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!rejectTarget | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/transactions/index.tsx:58` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/transactions/index.tsx:65` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/transactions/index.tsx:82` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/finance/transactions/index.tsx:92` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/transactions/index.tsx:106` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/finance/transactions/index.tsx:109` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/finance/transactions/index.tsx:238` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/finance/transactions/index.tsx:238` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/finance/transactions/index.tsx:242` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；traceCurrent | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/finance/transactions/index.tsx:244` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | TransactionsQueryDialog / 弹窗 | `frontend/src/pages/finance/transactions/index.tsx:255` → `frontend/src/pages/finance/transactions/index.tsx` | TransactionsQueryDialog 当前实际调用表面；queryOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/fixed-assets/index.tsx:43` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/fixed-assets/index.tsx:64` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/fixed-assets/index.tsx:109` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；true | 1 | 未查看 / 未执行 |
| 财务会计 | select / 选择器 | `frontend/src/pages/fixed-assets/index.tsx:118` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/fixed-assets/index.tsx:125` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/fixed-assets/index.tsx:217` → `frontend/src/components/shared/QueryErrorState.tsx` | 加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/fixed-assets/index.tsx:219` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | CreateDialog / 弹窗 | `frontend/src/pages/fixed-assets/index.tsx:223` → `frontend/src/pages/fixed-assets/index.tsx` | CreateDialog 当前实际调用表面；createOpen | 1 | 未查看 / 未执行 |
| 财务会计 | DisposeDialog / 弹窗 | `frontend/src/pages/fixed-assets/index.tsx:224` → `frontend/src/pages/fixed-assets/index.tsx` | DisposeDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/inbound-tasks/CloseReceivingDialog.tsx:27` → `frontend/src/components/shared/ConfirmDialog.tsx` | 结束收货；taskId != null && !action.pendingRecord | 2 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:66` → `frontend/src/components/shared/AppDialog.tsx` | 查询收货订单；open | 1 | 未查看 / 未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:98` → `frontend/src/components/shared/PickerField.tsx` | 供应商；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:108` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:121` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:131` → `frontend/src/components/shared/PickerField.tsx` | 商品；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | OperatorSelectField / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:141` → `frontend/src/components/shared/OperatorSelectField.tsx` | 全部经办人；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:153` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:158` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | SupplierFinder / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:175` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx:180` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/inbound-tasks/PurchaseItemPickerDialog.tsx:70` → `frontend/src/components/shared/AppDialog.tsx` | 选择收货商品；open | 1 | 未查看 / 未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/inbound-tasks/create.tsx:153` → `frontend/src/components/shared/PickerField.tsx` | 点击选择供应商…；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | SupplierFinder / 选择器 | `frontend/src/pages/inbound-tasks/create.tsx:250` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierFinderOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | PurchaseItemPickerDialog / 弹窗 | `frontend/src/pages/inbound-tasks/create.tsx:256` → `frontend/src/pages/inbound-tasks/PurchaseItemPickerDialog.tsx` | PurchaseItemPickerDialog 当前实际调用表面；pickerOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/inbound-tasks/detail.tsx:230` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/inbound-tasks/detail.tsx:279` → `frontend/src/components/shared/ConfirmDialog.tsx` | 取消收货订单；cancelConfirmOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/inbound-tasks/detail.tsx:300` → `frontend/src/components/shared/ConfirmDialog.tsx` | 撤回收货；voidConfirmOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | CloseReceivingDialog / 弹窗 | `frontend/src/pages/inbound-tasks/detail.tsx:330` → `frontend/src/pages/inbound-tasks/CloseReceivingDialog.tsx` | CloseReceivingDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | OrderPrintOverlay / 弹窗 | `frontend/src/pages/inbound-tasks/detail.tsx:334` → `frontend/src/components/print/OrderPrintOverlay.tsx` | task.taskNo；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/inbound-tasks/index.tsx:424` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | InboundTaskQueryDialog / 弹窗 | `frontend/src/pages/inbound-tasks/index.tsx:436` → `frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx` | InboundTaskQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | CloseReceivingDialog / 弹窗 | `frontend/src/pages/inbound-tasks/index.tsx:444` → `frontend/src/pages/inbound-tasks/CloseReceivingDialog.tsx` | CloseReceivingDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/inbound-tasks/index.tsx:445` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:48` → `frontend/src/components/shared/AppDialog.tsx` | 查询出入库记录；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:71` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:84` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:94` → `frontend/src/components/shared/PickerField.tsx` | 商品；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:104` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:109` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx:115` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/inventory/InventoryOverviewQueryDialog.tsx:35` → `frontend/src/components/shared/AppDialog.tsx` | 查询库存总览；open | 1 | 未查看 / 未执行 |
| 库存仓储 | CategoryTreeSelect / 选择器 | `frontend/src/pages/inventory/InventoryOverviewQueryDialog.tsx:69` → `frontend/src/components/shared/CategoryTreeSelect.tsx` | CategoryTreeSelect 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/inventory/InventoryOverviewQueryDialog.tsx:80` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/inventory/ReservationDetailsDialog.tsx:31` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && active | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/inventory/ReservationDetailsDialog.tsx:61` → `frontend/src/components/shared/QueryErrorState.tsx` | 预占明细读取失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | StatusBadge / 状态表面 | `frontend/src/pages/inventory/ReservationDetailsDialog.tsx:70` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | StatusBadge / 状态表面 | `frontend/src/pages/inventory/ReservationDetailsDialog.tsx:76` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | AvailableBadge / 状态表面 | `frontend/src/pages/inventory/index.tsx:279` → `frontend/src/pages/inventory/index.tsx` | AvailableBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | VirtualTableBody / 表格状态 | `frontend/src/pages/inventory/index.tsx:367` → `frontend/src/components/shared/VirtualTableBody.tsx` | VirtualTableBody 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ContainerDrawer / 抽屉 | `frontend/src/pages/inventory/index.tsx:382` → `frontend/src/components/shared/ContainerDrawer.tsx` | ContainerDrawer 当前实际调用表面；drawerOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | ReservationDetailsDialog / 弹窗 | `frontend/src/pages/inventory/index.tsx:383` → `frontend/src/pages/inventory/ReservationDetailsDialog.tsx` | ReservationDetailsDialog 当前实际调用表面；reservationItem != null | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/inventory/index.tsx:387` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/inventory/index.tsx:393` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；opOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/inventory/index.tsx:397` → `frontend/src/components/shared/PickerField.tsx` | 点击选择商品…；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/inventory/index.tsx:400` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/inventory/index.tsx:421` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；importOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | input / 选择器 | `frontend/src/pages/inventory/index.tsx:433` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/inventory/index.tsx:454` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productFinderOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | InventoryOverviewQueryDialog / 弹窗 | `frontend/src/pages/inventory/index.tsx:458` → `frontend/src/pages/inventory/InventoryOverviewQueryDialog.tsx` | InventoryOverviewQueryDialog 当前实际调用表面；overviewQueryOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | InventoryLogsQueryDialog / 弹窗 | `frontend/src/pages/inventory/index.tsx:464` → `frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx` | InventoryLogsQueryDialog 当前实际调用表面；logsQueryOpen | 1 | 未查看 / 未执行 |
| 基础资料 | AppDialog / 弹窗 | `frontend/src/pages/kits/KitEditor.tsx:44` → `frontend/src/components/shared/AppDialog.tsx` | 成套配件；true | 1 | 未查看 / 未执行 |
| 基础资料 | QueryErrorState / 状态表面 | `frontend/src/pages/kits/KitEditor.tsx:45` → `frontend/src/components/shared/QueryErrorState.tsx` | 资料读取失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | AppDialog / 弹窗 | `frontend/src/pages/kits/KitEditor.tsx:154` → `frontend/src/components/shared/AppDialog.tsx` | <span className="flex flex-wrap items-center gap-2">{baseline ? `${writable ? '维护' : '查看'}成套配件 · ${baseline.code}` : '新增成套配件'}{baseline && writable && <EditModeBadge />}<UnsavedBadge show={dirty} /></span>；true | 1 | 未查看 / 未执行 |
| 基础资料 | EditModeBadge / 状态表面 | `frontend/src/pages/kits/KitEditor.tsx:154` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | UnsavedBadge / 状态表面 | `frontend/src/pages/kits/KitEditor.tsx:154` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | PickerField / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:167` → `frontend/src/components/shared/PickerField.tsx` | 点击选择分类…；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | PickerField / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:168` → `frontend/src/components/shared/PickerField.tsx` | 点击选择供应商…；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:175` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:193` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:194` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | CategoryFinder / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:211` → `frontend/src/components/finder/CategoryFinder.tsx` | CategoryFinder 当前实际调用表面；categoryFinderOpen | 1 | 未查看 / 未执行 |
| 基础资料 | SupplierFinder / 选择器 | `frontend/src/pages/kits/KitEditor.tsx:212` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierFinderOpen | 1 | 未查看 / 未执行 |
| 基础资料 | ProductFinderModal / 弹窗 | `frontend/src/pages/kits/KitEditor.tsx:213` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinderModal 当前实际调用表面；finderOpen | 1 | 未查看 / 未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/kits/KitEditor.tsx:214` → `frontend/src/components/shared/ConfirmDialog.tsx` | 关闭维护；closeConfirm | 1 | 未查看 / 未执行 |
| 基础资料 | QueryErrorState / 状态表面 | `frontend/src/pages/kits/index.tsx:64` → `frontend/src/components/shared/QueryErrorState.tsx` | 成套配件加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | DeleteKitDialog / 弹窗 | `frontend/src/pages/kits/index.tsx:67` → `frontend/src/pages/kits/index.tsx` | DeleteKitDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | AppDialog / 弹窗 | `frontend/src/pages/kits/index.tsx:93` → `frontend/src/components/shared/AppDialog.tsx` | 删除成套配件；true | 1 | 未查看 / 未执行 |
| 系统设置 | nav / 导航/全局表面 | `frontend/src/pages/landing/index.tsx:175` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | nav / 导航/全局表面 | `frontend/src/pages/landing/index.tsx:205` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | nav / 导航/全局表面 | `frontend/src/pages/landing/index.tsx:562` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/locations/LocationQueryDialog.tsx:45` → `frontend/src/components/shared/AppDialog.tsx` | 查询库位；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/locations/LocationQueryDialog.tsx:79` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/locations/LocationQueryDialog.tsx:92` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/locations/index.tsx:140` → `frontend/src/components/shared/BaseCrudPage.tsx` | 库位管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/locations/index.tsx:206` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/locations/index.tsx:230` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | LocationQueryDialog / 弹窗 | `frontend/src/pages/locations/index.tsx:249` → `frontend/src/pages/locations/LocationQueryDialog.tsx` | LocationQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 打印物流 | Dialog / 弹窗 | `frontend/src/pages/logistics/DirectShipmentDialog.tsx:38` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；true | 1 | 未查看 / 未执行 |
| 打印物流 | ShippingProductField / 选择器 | `frontend/src/pages/logistics/DirectShipmentDialog.tsx:44` → `frontend/src/components/shared/ShippingProductField.tsx` | ShippingProductField 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/logistics/DirectShipmentDialog.tsx:46` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/logistics/DirectShipmentDialog.tsx:47` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | AppDialog / 弹窗 | `frontend/src/pages/logistics/WaybillQueryDialog.tsx:53` → `frontend/src/components/shared/AppDialog.tsx` | 查询物流运单；open | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/logistics/WaybillQueryDialog.tsx:87` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/logistics/WaybillQueryDialog.tsx:98` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DatePicker / 选择器 | `frontend/src/pages/logistics/WaybillQueryDialog.tsx:111` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 打印物流 | DatePicker / 选择器 | `frontend/src/pages/logistics/WaybillQueryDialog.tsx:116` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 打印物流 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/logistics/detail.tsx:140` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 作废运单本地记录；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | QueryErrorState / 状态表面 | `frontend/src/pages/logistics/detail.tsx:149` → `frontend/src/components/shared/QueryErrorState.tsx` | 运单加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DirectShipmentDialog / 弹窗 | `frontend/src/pages/logistics/detail.tsx:193` → `frontend/src/pages/logistics/DirectShipmentDialog.tsx` | DirectShipmentDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Dialog / 弹窗 | `frontend/src/pages/logistics/detail.tsx:194` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!trackTarget | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/logistics/freight-reconciliation.tsx:102` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/logistics/freight-reconciliation.tsx:119` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 生成承运商应付；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DataTable / 表格状态 | `frontend/src/pages/logistics/freight-reconciliation.tsx:132` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DataTable / 表格状态 | `frontend/src/pages/logistics/freight-reconciliation.tsx:136` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Dialog / 弹窗 | `frontend/src/pages/logistics/freight-reconciliation.tsx:139` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；billDialog | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/logistics/freight-reconciliation.tsx:145` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/logistics/index.tsx:123` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 作废运单本地记录；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | QueryErrorState / 状态表面 | `frontend/src/pages/logistics/index.tsx:169` → `frontend/src/components/shared/QueryErrorState.tsx` | 运单加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DataTable / 表格状态 | `frontend/src/pages/logistics/index.tsx:172` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Dialog / 弹窗 | `frontend/src/pages/logistics/index.tsx:183` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!trackTarget | 1 | 未查看 / 未执行 |
| 打印物流 | WaybillQueryDialog / 弹窗 | `frontend/src/pages/logistics/index.tsx:200` → `frontend/src/pages/logistics/WaybillQueryDialog.tsx` | WaybillQueryDialog 当前实际调用表面；queryOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 系统设置 | AppDialog / 弹窗 | `frontend/src/pages/oplogs/OpLogQueryDialog.tsx:43` → `frontend/src/components/shared/AppDialog.tsx` | 查询操作日志；open | 1 | 未查看 / 未执行 |
| 系统设置 | Select / 选择器 | `frontend/src/pages/oplogs/OpLogQueryDialog.tsx:77` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | DatePicker / 选择器 | `frontend/src/pages/oplogs/OpLogQueryDialog.tsx:90` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | DatePicker / 选择器 | `frontend/src/pages/oplogs/OpLogQueryDialog.tsx:95` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | DataTable / 表格状态 | `frontend/src/pages/oplogs/index.tsx:206` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/pages/oplogs/index.tsx:216` → `frontend/src/components/shared/ConfirmDialog.tsx` | 清理旧日志；clearConfirm | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/oplogs/index.tsx:225` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!detail | 1 | 未查看 / 未执行 |
| 系统设置 | OpLogQueryDialog / 弹窗 | `frontend/src/pages/oplogs/index.tsx:265` → `frontend/src/pages/oplogs/OpLogQueryDialog.tsx` | OpLogQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | nav / 导航/全局表面 | `frontend/src/pages/payments/PaymentsView.tsx:170` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/payments/PaymentsView.tsx:192` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/payments/PaymentsView.tsx:192` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | PaymentQueryDialog / 弹窗 | `frontend/src/pages/payments/PaymentsView.tsx:196` → `frontend/src/components/shared/PaymentQueryDialog.tsx` | PaymentQueryDialog 当前实际调用表面；queryOpen | 2 | 未查看 / 未执行 |
| 财务会计 | CreateManualPayableDialog / 弹窗 | `frontend/src/pages/payments/PaymentsView.tsx:213` → `frontend/src/components/shared/payments/CreateManualPayableDialog.tsx` | CreateManualPayableDialog 当前实际调用表面；createOpen | 2 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/payments/party-ledger.tsx:52` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；true | 2 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/payments/party-ledger.tsx:54` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/payments/party-ledger.tsx:58` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/payments/party-ledger.tsx:63` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/payments/party-ledger.tsx:115` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/payments/party-ledger.tsx:117` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/payments/party-ledger.tsx:121` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/payments/party-ledger.tsx:136` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/adjustment.tsx:41` → `frontend/src/components/pda/PdaHeader.tsx` | 改单确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:45` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:46` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/adjustment.tsx:206` → `frontend/src/components/pda/PdaHeader.tsx` | 改单确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:207` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/adjustment.tsx:214` → `frontend/src/components/pda/PdaHeader.tsx` | 改单确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:215` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/adjustment.tsx:222` → `frontend/src/components/pda/PdaHeader.tsx` | 改单确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:227` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:228` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/adjustment.tsx:247` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/adjustment.tsx:335` → `frontend/src/components/pda/PdaScanner.tsx` | step === 'scan-location' ? `扫描原库位条码确认放回：${target?.suggestedLocationCode ?? ''}` : '扫描待拆箱箱子条码或待归还库存条码'；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | CameraOverlay / 弹窗 | `frontend/src/pages/pda/bind.tsx:144` → `frontend/src/pages/pda/bind.tsx` | CameraOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/bind.tsx:151` → `frontend/src/components/pda/PdaHeader.tsx` | 设备绑定；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/bind.tsx:152` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/bind.tsx:231` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描绑定二维码；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/cancel-return.tsx:47` → `frontend/src/components/pda/PdaHeader.tsx` | 拣货退回；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/cancel-return.tsx:51` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/cancel-return.tsx:52` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/cancel-return.tsx:220` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/cancel-return.tsx:231` → `frontend/src/components/pda/PdaHeader.tsx` | 拣货退回确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/cancel-return.tsx:232` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/cancel-return.tsx:239` → `frontend/src/components/pda/PdaHeader.tsx` | 拣货退回确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/cancel-return.tsx:240` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/cancel-return.tsx:247` → `frontend/src/components/pda/PdaHeader.tsx` | 拣货退回确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/cancel-return.tsx:327` → `frontend/src/components/pda/PdaScanner.tsx` | step === 'scan-location' ? `扫描原库位条码确认放回：${target?.suggestedLocationCode ?? ''}` : '扫描待归还库存条码或待拆箱箱子条码'；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/check.tsx:61` → `frontend/src/components/pda/PdaHeader.tsx` | 选择复核任务；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/check.tsx:65` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/check.tsx:66` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaTaskState / 状态表面 | `frontend/src/pages/pda/check.tsx:261` → `frontend/src/components/pda/PdaTaskState.tsx` | 缺少复核任务；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/check.tsx:275` → `frontend/src/components/pda/PdaHeader.tsx` | 复核作业；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/check.tsx:278` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaTaskState / 状态表面 | `frontend/src/pages/pda/check.tsx:288` → `frontend/src/components/pda/PdaTaskState.tsx` | 复核任务不存在；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaTaskState / 状态表面 | `frontend/src/pages/pda/check.tsx:302` → `frontend/src/components/pda/PdaTaskState.tsx` | 当前任务不能复核；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/check.tsx:353` → `frontend/src/components/pda/PdaHeader.tsx` | taskDetail?.taskNo ?? '…'；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/check.tsx:361` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/check.tsx:365` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/check.tsx:400` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描库存条码；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/fill.tsx:233` → `frontend/src/components/pda/PdaHeader.tsx` | 塑料盒放货；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/fill.tsx:234` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/fill.tsx:285` → `frontend/src/components/pda/PdaScanner.tsx` | step === 'source' ? '扫描整件库存条码' : '扫描目标塑料盒条码'；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/inbound.tsx:79` → `frontend/src/components/pda/PdaHeader.tsx` | 收货订单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/inbound.tsx:82` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/inbound.tsx:83` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/inventory-query.tsx:88` → `frontend/src/components/pda/PdaHeader.tsx` | 库存查询；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/inventory-query.tsx:106` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/inventory-query.tsx:108` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描库存条码（I…/B…）；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/pack.tsx:64` → `frontend/src/components/pda/PdaHeader.tsx` | 选择打包任务；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/pack.tsx:67` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/pack.tsx:68` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/pack.tsx:758` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaTaskState / 状态表面 | `frontend/src/pages/pda/pack.tsx:842` → `frontend/src/components/pda/PdaTaskState.tsx` | 缺少打包任务；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/pack.tsx:856` → `frontend/src/components/pda/PdaHeader.tsx` | 打包作业；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/pack.tsx:859` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/pack.tsx:867` → `frontend/src/components/pda/PdaHeader.tsx` | 打包作业；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/pack.tsx:867` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaTaskState / 状态表面 | `frontend/src/pages/pda/pack.tsx:871` → `frontend/src/components/pda/PdaTaskState.tsx` | 打包任务不存在；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaTaskState / 状态表面 | `frontend/src/pages/pda/pack.tsx:887` → `frontend/src/components/pda/PdaTaskState.tsx` | 当前任务不能打包；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaDoneView / 状态表面 | `frontend/src/pages/pda/pack.tsx:906` → `frontend/src/components/pda/PdaDoneView.tsx` | 打包完成！；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/pack.tsx:926` → `frontend/src/components/pda/PdaHeader.tsx` | taskDetail.taskNo；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/pack.tsx:934` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/pack.tsx:948` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/pack.tsx:949` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/pack.tsx:1026` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描商品条码或取货标签；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/picking.tsx:236` → `frontend/src/components/pda/PdaHeader.tsx` | 拣货任务；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/picking.tsx:240` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/picking.tsx:254` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/plastic-box.tsx:30` → `frontend/src/components/pda/PdaHeader.tsx` | 塑料盒作业；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:76` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/putaway.tsx:84` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/putaway.tsx:87` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/putaway.tsx:130` → `frontend/src/components/pda/PdaScanner.tsx` | engine.currentStep.placeholder；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:160` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/putaway.tsx:161` → `frontend/src/components/pda/PdaEmptyState.tsx` | 请选择上架任务；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:174` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/putaway.tsx:175` → `frontend/src/components/pda/PdaEmptyState.tsx` | 加载失败；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:182` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/putaway.tsx:183` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:191` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/putaway.tsx:192` → `frontend/src/components/pda/PdaEmptyState.tsx` | 尚未收货；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:206` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/putaway.tsx:207` → `frontend/src/components/pda/PdaEmptyState.tsx` | 未提交；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:221` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/putaway.tsx:222` → `frontend/src/components/pda/PdaEmptyState.tsx` | task.status === 5 ? '已取消' : '已完成'；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/putaway.tsx:235` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码上架；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/putaway.tsx:236` → `frontend/src/components/pda/PdaEmptyState.tsx` | 暂无待上架货物；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/receive.tsx:429` → `frontend/src/components/pda/PdaHeader.tsx` | task.taskNo；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/receive.tsx:436` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/receive.tsx:439` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/receive.tsx:440` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | input / 选择器 | `frontend/src/pages/pda/receive.tsx:520` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | input / 选择器 | `frontend/src/pages/pda/receive.tsx:525` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaOverReceiveDialog / 弹窗 | `frontend/src/pages/pda/receive.tsx:563` → `frontend/src/components/pda/PdaOverReceiveDialog.tsx` | PdaOverReceiveDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已捕获；人工细看待核实 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/receive.tsx:613` → `frontend/src/components/pda/PdaHeader.tsx` | 收货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/receive.tsx:613` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/receive.tsx:618` → `frontend/src/components/pda/PdaHeader.tsx` | 收货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/receive.tsx:619` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:106` → `frontend/src/components/pda/PdaHeader.tsx` | 退货上架；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:106` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:107` → `frontend/src/components/pda/PdaHeader.tsx` | 退货上架；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:107` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:108` → `frontend/src/components/pda/PdaHeader.tsx` | 退货上架；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:109` → `frontend/src/components/pda/PdaHeader.tsx` | 退货上架；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:110` → `frontend/src/components/pda/PdaHeader.tsx` | 退货上架；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:114` → `frontend/src/components/pda/PdaHeader.tsx` | 退货上架；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/sale-return-putaway.tsx:115` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/sale-return-putaway.tsx:159` → `frontend/src/components/pda/PdaScanner.tsx` | step === 'container' ? '扫描库存条码…' : '扫描库位条码…'；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-receive.tsx:134` → `frontend/src/components/pda/PdaHeader.tsx` | 退货收货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/sale-return-receive.tsx:134` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-receive.tsx:135` → `frontend/src/components/pda/PdaHeader.tsx` | 退货收货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/sale-return-receive.tsx:135` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-receive.tsx:136` → `frontend/src/components/pda/PdaHeader.tsx` | 退货收货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-receive.tsx:137` → `frontend/src/components/pda/PdaHeader.tsx` | 退货收货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-receive.tsx:139` → `frontend/src/components/pda/PdaHeader.tsx` | 退货质检；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return-receive.tsx:173` → `frontend/src/components/pda/PdaHeader.tsx` | task.status <= 2 ? '退货收货' : '退货质检'；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/sale-return-receive.tsx:174` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/sale-return-receive.tsx:251` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描商品条码…；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sale-return.tsx:51` → `frontend/src/components/pda/PdaHeader.tsx` | 销售退货；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/sale-return.tsx:53` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/sale-return.tsx:54` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/ship.tsx:184` → `frontend/src/components/pda/PdaHeader.tsx` | 出库确认；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/ship.tsx:186` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/ship.tsx:190` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/ship.tsx:210` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/ship.tsx:332` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描物流条码；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/ship.tsx:333` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/sort.tsx:225` → `frontend/src/components/pda/PdaHeader.tsx` | 分拣作业；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/sort.tsx:231` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/sort.tsx:232` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/sort.tsx:318` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/sort.tsx:319` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/sort.tsx:350` → `frontend/src/components/pda/PdaScanner.tsx` | step === 'scan-product' ? '扫描商品条码' : '扫描分拣格条码'；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/split-recovery.tsx:14` → `frontend/src/components/pda/PdaHeader.tsx` | 拆分结果核对；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/split-recovery.tsx:15` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaSplitRecoveryPanel / 状态表面 | `frontend/src/pages/pda/split-recovery.tsx:16` → `frontend/src/components/pda/PdaSplitRecoveryPanel.tsx` | PdaSplitRecoveryPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/split.tsx:272` → `frontend/src/components/pda/PdaHeader.tsx` | fixedMode === 'split' ? '拆出散件盒' : fixedMode === 'repack' ? '盒还原整件' : LEGACY_PAGE_TITLE；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/split.tsx:277` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaSplitRecoveryPanel / 状态表面 | `frontend/src/pages/pda/split.tsx:279` → `frontend/src/components/pda/PdaSplitRecoveryPanel.tsx` | PdaSplitRecoveryPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | input / 选择器 | `frontend/src/pages/pda/split.tsx:354` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/split.tsx:398` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描塑料盒或库存条码；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/stockcheck.tsx:52` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/stockcheck.tsx:55` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码盘点；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/stockcheck.tsx:57` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/stockcheck.tsx:162` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/stockcheck.tsx:163` → `frontend/src/components/pda/PdaHeader.tsx` | 扫码盘点；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/stockcheck.tsx:163` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/stockcheck.tsx:170` → `frontend/src/components/pda/PdaHeader.tsx` | activeItem.productCode \|\| '盘点作业'；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/stockcheck.tsx:220` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描在架库存条码；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/stockcheck.tsx:225` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/stockcheck.tsx:233` → `frontend/src/components/pda/PdaHeader.tsx` | detail.checkNo；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/stockcheck.tsx:267` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| PDA | PdaDoneView / 状态表面 | `frontend/src/pages/pda/task.tsx:354` → `frontend/src/components/pda/PdaDoneView.tsx` | 拣货完成！；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/task.tsx:371` → `frontend/src/components/pda/PdaHeader.tsx` | task?.taskNo ?? '…'；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/task.tsx:380` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/task.tsx:385` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/task.tsx:412` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/task.tsx:413` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/task.tsx:429` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描库存条码；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:88` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-in.tsx:111` → `frontend/src/components/pda/PdaHeader.tsx` | 调入仓扫码入库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:112` → `frontend/src/components/pda/PdaEmptyState.tsx` | 请选择调拨单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-in.tsx:116` → `frontend/src/components/pda/PdaHeader.tsx` | 调入仓扫码入库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:116` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-in.tsx:121` → `frontend/src/components/pda/PdaHeader.tsx` | 调入仓扫码入库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:122` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-in.tsx:129` → `frontend/src/components/pda/PdaHeader.tsx` | 调入仓扫码入库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:130` → `frontend/src/components/pda/PdaEmptyState.tsx` | order.statusName；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-in.tsx:139` → `frontend/src/components/pda/PdaHeader.tsx` | 调入仓扫码入库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:145` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/transfer-in.tsx:149` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/transfer-in.tsx:177` → `frontend/src/components/pda/PdaScanner.tsx` | pendingContainer ? '扫描目标库位条码' : '扫描在途库存条码'；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaCriticalActionNotice / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:67` → `frontend/src/components/pda/PdaCriticalActionNotice.tsx` | PdaCriticalActionNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-out.tsx:90` → `frontend/src/components/pda/PdaHeader.tsx` | 调出仓扫码出库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:91` → `frontend/src/components/pda/PdaEmptyState.tsx` | 请选择调拨单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-out.tsx:95` → `frontend/src/components/pda/PdaHeader.tsx` | 调出仓扫码出库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:95` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-out.tsx:100` → `frontend/src/components/pda/PdaHeader.tsx` | 调出仓扫码出库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:101` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-out.tsx:108` → `frontend/src/components/pda/PdaHeader.tsx` | 调出仓扫码出库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaEmptyState / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:109` → `frontend/src/components/pda/PdaEmptyState.tsx` | order.statusName；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer-out.tsx:118` → `frontend/src/components/pda/PdaHeader.tsx` | 调出仓扫码出库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaFlash / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:124` → `frontend/src/components/pda/PdaFlash.tsx` | PdaFlash 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/transfer-out.tsx:128` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaScanner / 扫码输入 | `frontend/src/pages/pda/transfer-out.tsx:158` → `frontend/src/components/pda/PdaScanner.tsx` | 扫描调出仓库存条码；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaHeader / 导航/全局表面 | `frontend/src/pages/pda/transfer.tsx:64` → `frontend/src/components/pda/PdaHeader.tsx` | 调拨执行；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaLoading / 状态表面 | `frontend/src/pages/pda/transfer.tsx:66` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaLoading 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| PDA | PdaQueryError / 状态表面 | `frontend/src/pages/pda/transfer.tsx:67` → `frontend/src/components/pda/PdaEmptyState.tsx` | PdaQueryError 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/permissions/index.tsx:52` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!role | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/permissions/index.tsx:104` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 系统设置 | useDirtyGuardStore.getState().showConfirm / 命令式确认弹窗 | `frontend/src/pages/permissions/index.tsx:177` | 切换角色将丢弃当前未保存的权限修改，确定切换吗？；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | EditModeBadge / 状态表面 | `frontend/src/pages/permissions/index.tsx:205` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | UnsavedBadge / 状态表面 | `frontend/src/pages/permissions/index.tsx:206` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | QueryErrorState / 状态表面 | `frontend/src/pages/permissions/index.tsx:281` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | CreateRoleDialog / 弹窗 | `frontend/src/pages/permissions/index.tsx:332` → `frontend/src/pages/permissions/index.tsx` | CreateRoleDialog 当前实际调用表面；createOpen | 1 | 未查看 / 未执行 |
| 系统设置 | DuplicateRoleDialog / 弹窗 | `frontend/src/pages/permissions/index.tsx:333` → `frontend/src/pages/permissions/index.tsx` | DuplicateRoleDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/pages/permissions/index.tsx:335` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除；!!delTarget | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/picking-waves/WaveQueryDialog.tsx:45` → `frontend/src/components/shared/AppDialog.tsx` | 查询批次；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/picking-waves/WaveQueryDialog.tsx:79` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/picking-waves/WaveQueryDialog.tsx:92` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/picking-waves/WaveQueryDialog.tsx:104` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/picking-waves/WaveQueryDialog.tsx:109` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/picking-waves/index.tsx:257` → `frontend/src/components/shared/QueryErrorState.tsx` | 批次列表加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/picking-waves/index.tsx:258` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/picking-waves/index.tsx:262` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!selectedWaveId | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/picking-waves/index.tsx:271` → `frontend/src/components/shared/QueryErrorState.tsx` | 批次详情加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/picking-waves/index.tsx:321` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 取消批次；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WaveQueryDialog / 弹窗 | `frontend/src/pages/picking-waves/index.tsx:338` → `frontend/src/pages/picking-waves/WaveQueryDialog.tsx` | WaveQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/plastic-boxes/index.tsx:144` → `frontend/src/components/shared/BaseCrudPage.tsx` | 塑料盒管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/plastic-boxes/index.tsx:207` → `frontend/src/components/shared/PickerField.tsx` | 点击选择商品…；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/plastic-boxes/index.tsx:211` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择仓库；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/plastic-boxes/index.tsx:219` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productFinderOpen && !locked | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | DetailDialog / 弹窗 | `frontend/src/pages/plastic-boxes/index.tsx:236` → `frontend/src/pages/plastic-boxes/index.tsx` | DetailDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/plastic-boxes/index.tsx:275` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!box | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/plastic-boxes/index.tsx:300` → `frontend/src/components/shared/QueryErrorState.tsx` | 来源贡献加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/plastic-boxes/index.tsx:332` → `frontend/src/components/shared/QueryErrorState.tsx` | 塑料盒流水加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | EmptyState / 状态表面 | `frontend/src/pages/plastic-boxes/index.tsx:336` → `frontend/src/components/shared/EmptyState.tsx` | 暂无流水；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | RepackDialog / 弹窗 | `frontend/src/pages/plastic-boxes/index.tsx:366` → `frontend/src/pages/plastic-boxes/index.tsx` | RepackDialog 当前实际调用表面；repackOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/plastic-boxes/index.tsx:418` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | PickerField / 选择器 | `frontend/src/pages/portal/statements.tsx:61` → `frontend/src/components/shared/PickerField.tsx` | 选择要查看的客户；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/portal/statements.tsx:67` → `frontend/src/components/shared/QueryErrorState.tsx` | 对账单加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/portal/statements.tsx:67` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | CustomerFinder / 选择器 | `frontend/src/pages/portal/statements.tsx:78` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；finderOpen | 1 | 未查看 / 未执行 |
| 基础资料 | OrderActivityDialog / 弹窗 | `frontend/src/pages/price-change/index.tsx:179` → `frontend/src/components/shared/OrderActivityDialog.tsx` | row.requestNo；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | DataTable / 表格状态 | `frontend/src/pages/price-change/index.tsx:204` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | ApprovalHandoffNotice / 状态表面 | `frontend/src/pages/price-change/index.tsx:207` → `frontend/src/components/shared/ApprovalHandoffNotice.tsx` | ApprovalHandoffNotice 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | OrderActivityDialog / 弹窗 | `frontend/src/pages/price-change/index.tsx:208` → `frontend/src/components/shared/OrderActivityDialog.tsx` | handoff.data.requestNo；handoff.open | 1 | 未查看 / 未执行 |
| 基础资料 | Dialog / 弹窗 | `frontend/src/pages/price-change/index.tsx:212` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；createOpen | 1 | 未查看 / 未执行 |
| 基础资料 | Select / 选择器 | `frontend/src/pages/price-change/index.tsx:224` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | ProductFinderModal / 弹窗 | `frontend/src/pages/price-change/index.tsx:248` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinderModal 当前实际调用表面；productFinderOpen | 1 | 未查看 / 未执行 |
| 基础资料 | Dialog / 弹窗 | `frontend/src/pages/price-change/index.tsx:255` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!rejectTarget | 1 | 未查看 / 未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/price-change/index.tsx:269` → `frontend/src/components/shared/ConfirmDialog.tsx` | 取消改价申请；!!cancelTarget | 1 | 未查看 / 未执行 |
| 采购 | QueryErrorState / 状态表面 | `frontend/src/pages/procurement/detail.tsx:76` → `frontend/src/components/shared/QueryErrorState.tsx` | 采购计划加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/procurement/detail.tsx:89` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 作废该采购计划？；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | QueryErrorState / 状态表面 | `frontend/src/pages/procurement/detail.tsx:94` → `frontend/src/components/shared/QueryErrorState.tsx` | 刷新失败，当前显示上次读取的数据；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | input / 选择器 | `frontend/src/pages/procurement/detail.tsx:102` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | input / 选择器 | `frontend/src/pages/procurement/detail.tsx:128` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | Select / 选择器 | `frontend/src/pages/procurement/detail.tsx:148` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | QueryErrorState / 状态表面 | `frontend/src/pages/procurement/index.tsx:84` → `frontend/src/components/shared/QueryErrorState.tsx` | data ? '刷新失败，当前显示上次读取的数据' : '采购计划加载失败'；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | DataTable / 表格状态 | `frontend/src/pages/procurement/index.tsx:85` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/pages/procurement/index.tsx:87` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；genOpen | 1 | 未查看 / 未执行 |
| 采购 | Select / 选择器 | `frontend/src/pages/procurement/index.tsx:105` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | Select / 选择器 | `frontend/src/pages/procurement/index.tsx:116` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | AppDialog / 弹窗 | `frontend/src/pages/products/ProductQueryDialog.tsx:43` → `frontend/src/components/shared/AppDialog.tsx` | 查询商品；open | 1 | 未查看 / 未执行 |
| 基础资料 | CategoryTreeSelect / 选择器 | `frontend/src/pages/products/ProductQueryDialog.tsx:77` → `frontend/src/components/shared/CategoryTreeSelect.tsx` | CategoryTreeSelect 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | Select / 选择器 | `frontend/src/pages/products/ProductQueryDialog.tsx:88` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | PickerField / 选择器 | `frontend/src/pages/products/ProductQueryDialog.tsx:98` → `frontend/src/components/shared/PickerField.tsx` | 供应商；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | SupplierFinder / 选择器 | `frontend/src/pages/products/ProductQueryDialog.tsx:130` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierOpen | 1 | 未查看 / 未执行 |
| 基础资料 | EditModeBadge / 状态表面 | `frontend/src/pages/products/form.tsx:285` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | UnsavedBadge / 状态表面 | `frontend/src/pages/products/form.tsx:289` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | PickerField / 选择器 | `frontend/src/pages/products/form.tsx:312` → `frontend/src/components/shared/PickerField.tsx` | 点击选择分类…；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | CategoryFinder / 选择器 | `frontend/src/pages/products/form.tsx:318` → `frontend/src/components/finder/CategoryFinder.tsx` | CategoryFinder 当前实际调用表面；categoryFinderOpen | 2 | 未查看 / 未执行 |
| 基础资料 | PickerField / 选择器 | `frontend/src/pages/products/form.tsx:328` → `frontend/src/components/shared/PickerField.tsx` | 点击选择供应商…；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | SupplierFinder / 选择器 | `frontend/src/pages/products/form.tsx:334` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierFinderOpen | 2 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/products/form.tsx:363` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/products/form.tsx:371` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/products/form.tsx:477` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 基础资料 | Dialog / 弹窗 | `frontend/src/pages/products/index.tsx:233` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；importOpen | 1 | 未查看 / 未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/products/index.tsx:245` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | ConfirmDialog / 弹窗 | `frontend/src/pages/products/index.tsx:269` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除商品；!!confirmProduct | 1 | 未查看 / 未执行 |
| 基础资料 | ProductQueryDialog / 弹窗 | `frontend/src/pages/products/index.tsx:278` → `frontend/src/pages/products/ProductQueryDialog.tsx` | ProductQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 采购 | AppDialog / 弹窗 | `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx:52` → `frontend/src/components/shared/AppDialog.tsx` | 查询采购申请单；open | 1 | 未查看 / 未执行 |
| 采购 | Select / 选择器 | `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx:86` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | WarehouseSelect / 选择器 | `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx:102` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | OperatorSelectField / 选择器 | `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx:114` → `frontend/src/components/shared/OperatorSelectField.tsx` | 全部申请人；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | DatePicker / 选择器 | `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx:126` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | DatePicker / 选择器 | `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx:131` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/purchase-requisitions/form.tsx:343` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 取消采购申请单；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | WarehouseSelect / 选择器 | `frontend/src/pages/purchase-requisitions/form.tsx:364` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择期望入库仓；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | DatePicker / 选择器 | `frontend/src/pages/purchase-requisitions/form.tsx:369` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | PickerField / 选择器 | `frontend/src/pages/purchase-requisitions/form.tsx:408` → `frontend/src/components/shared/PickerField.tsx` | 选填，可转单时定；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | ProductFinder / 选择器 | `frontend/src/pages/purchase-requisitions/form.tsx:422` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productFinderOpen | 2 | 未查看 / 未执行 |
| 采购 | SupplierFinder / 选择器 | `frontend/src/pages/purchase-requisitions/form.tsx:423` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；!!supplierTarget | 2 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/pages/purchase-requisitions/form.tsx:426` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；rejectOpen | 2 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/pages/purchase-requisitions/form.tsx:441` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；convertOpen | 2 | 未查看 / 未执行 |
| 采购 | PickerField / 选择器 | `frontend/src/pages/purchase-requisitions/form.tsx:462` → `frontend/src/components/shared/PickerField.tsx` | 选择供应商；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | UncertainSubmitNotice / 状态表面 | `frontend/src/pages/purchase-requisitions/form.tsx:469` → `frontend/src/components/shared/payments/UncertainSubmitNotice.tsx` | UncertainSubmitNotice 当前实际调用表面；convertGuard.uncertain | 2 | 未查看 / 未执行 |
| 采购 | DataTable / 表格状态 | `frontend/src/pages/purchase-requisitions/index.tsx:141` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | RequisitionQueryDialog / 弹窗 | `frontend/src/pages/purchase-requisitions/index.tsx:150` → `frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx` | RequisitionQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 采购 | AppDialog / 弹窗 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:65` → `frontend/src/components/shared/AppDialog.tsx` | 查询采购单；open | 1 | 未查看 / 未执行 |
| 采购 | Select / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:99` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | PickerField / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:111` → `frontend/src/components/shared/PickerField.tsx` | 供应商；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | WarehouseSelect / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:121` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | PickerField / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:131` → `frontend/src/components/shared/PickerField.tsx` | 商品；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | OperatorSelectField / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:141` → `frontend/src/components/shared/OperatorSelectField.tsx` | 全部经办人；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | DatePicker / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:153` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | DatePicker / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:158` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | SupplierFinder / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:175` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierOpen | 1 | 未查看 / 未执行 |
| 采购 | ProductFinder / 选择器 | `frontend/src/pages/purchase/PurchaseQueryDialog.tsx:180` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productOpen | 1 | 未查看 / 未执行 |
| 采购 | EditModeBadge / 状态表面 | `frontend/src/pages/purchase/form/index.tsx:279` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | UnsavedBadge / 状态表面 | `frontend/src/pages/purchase/form/index.tsx:279` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | OrderEntryIssues / 状态表面 | `frontend/src/pages/purchase/form/index.tsx:304` → `frontend/src/components/shared/OrderEntryIssues.tsx` | OrderEntryIssues 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | PickerField / 选择器 | `frontend/src/pages/purchase/form/index.tsx:309` → `frontend/src/components/shared/PickerField.tsx` | 点击选择供应商…；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | WarehouseSelect / 选择器 | `frontend/src/pages/purchase/form/index.tsx:325` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择仓库；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | DatePicker / 选择器 | `frontend/src/pages/purchase/form/index.tsx:337` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | select / 选择器 | `frontend/src/pages/purchase/form/index.tsx:411` | 录入单位；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | ProductFinder / 选择器 | `frontend/src/pages/purchase/form/index.tsx:489` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finderOpen | 2 | 未查看 / 未执行 |
| 采购 | SupplierFinder / 选择器 | `frontend/src/pages/purchase/form/index.tsx:501` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierFinderOpen | 2 | 未查看 / 未执行 |
| 采购 | StatusBadge / 状态表面 | `frontend/src/pages/purchase/form/index.tsx:579` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | DataTable / 表格状态 | `frontend/src/pages/purchase/form/index.tsx:708` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | ConfirmDialog / 弹窗 | `frontend/src/pages/purchase/form/index.tsx:750` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 2 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/pages/purchase/form/index.tsx:765` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；rejectOpen | 2 | 未查看 / 未执行 |
| 采购 | StatusBadge / 状态表面 | `frontend/src/pages/purchase/index.tsx:223` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | QueryErrorState / 状态表面 | `frontend/src/pages/purchase/index.tsx:352` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 采购 | DataTable / 表格状态 | `frontend/src/pages/purchase/index.tsx:352` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 采购 | OrderPrintOverlay / 弹窗 | `frontend/src/pages/purchase/index.tsx:364` → `frontend/src/components/print/OrderPrintOverlay.tsx` | printDetail.orderNo；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | ConfirmDialog / 弹窗 | `frontend/src/pages/purchase/index.tsx:372` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 1 | 未查看 / 未执行 |
| 采购 | PurchaseQueryDialog / 弹窗 | `frontend/src/pages/purchase/index.tsx:383` → `frontend/src/pages/purchase/PurchaseQueryDialog.tsx` | PurchaseQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/pages/purchase/index.tsx:392` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!rejectTarget | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/racks/RackQueryDialog.tsx:37` → `frontend/src/components/shared/AppDialog.tsx` | 查询货架；open | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/racks/RackQueryDialog.tsx:71` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/racks/index.tsx:148` → `frontend/src/components/shared/BaseCrudPage.tsx` | 货架管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/racks/index.tsx:243` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/racks/index.tsx:359` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | RackQueryDialog / 弹窗 | `frontend/src/pages/racks/index.tsx:406` → `frontend/src/pages/racks/RackQueryDialog.tsx` | RackQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | AppDialog / 弹窗 | `frontend/src/pages/refunds/RefundQueryDialog.tsx:42` → `frontend/src/components/shared/AppDialog.tsx` | 查询退款单；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/refunds/RefundQueryDialog.tsx:76` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/refunds/RefundQueryDialog.tsx:90` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/refunds/RefundQueryDialog.tsx:95` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:138` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && sectionActive | 1 | 未查看 / 未执行 |
| 财务会计 | UncertainSubmitNotice / 状态表面 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:146` → `frontend/src/components/shared/payments/UncertainSubmitNotice.tsx` | UncertainSubmitNotice 当前实际调用表面；guard.uncertain | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:165` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:186` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 确认退款单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:194` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 执行退款；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:203` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 取消退款单；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | BackfillRequestDialog / 弹窗 | `frontend/src/pages/refunds/components/RefundDetailDialog.tsx:215` → `frontend/src/components/shared/payments/BackfillRequestDialog.tsx` | BackfillRequestDialog 当前实际调用表面；!!prompt && open && sectionActive | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/refunds/index.tsx:127` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/refunds/index.tsx:128` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | CreateRefundDialog / 弹窗 | `frontend/src/pages/refunds/index.tsx:132` → `frontend/src/pages/refunds/index.tsx` | CreateRefundDialog 当前实际调用表面；createOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | RefundDetailDialog / 弹窗 | `frontend/src/pages/refunds/index.tsx:133` → `frontend/src/pages/refunds/components/RefundDetailDialog.tsx` | RefundDetailDialog 当前实际调用表面；!!detailId | 1 | 未查看 / 未执行 |
| 财务会计 | RefundQueryDialog / 弹窗 | `frontend/src/pages/refunds/index.tsx:134` → `frontend/src/pages/refunds/RefundQueryDialog.tsx` | RefundQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/refunds/index.tsx:186` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/refunds/index.tsx:201` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/refunds/index.tsx:211` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/reports/InventoryAgingQueryDialog.tsx:34` → `frontend/src/components/shared/AppDialog.tsx` | 查询存放时长与滞销；open | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/reports/InventoryAgingQueryDialog.tsx:68` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/reports/InventoryAgingQueryDialog.tsx:80` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | PaymentQueryDialog / 弹窗 | `frontend/src/pages/reports/ReconciliationView.tsx:246` → `frontend/src/components/shared/PaymentQueryDialog.tsx` | PaymentQueryDialog 当前实际调用表面；queryOpen | 2 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/ReconciliationView.tsx:258` → `frontend/src/components/shared/QueryErrorState.tsx` | 对账数据加载失败；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/ReconciliationView.tsx:268` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | SettlementConfirmDialog / 弹窗 | `frontend/src/pages/reports/ReconciliationView.tsx:279` → `frontend/src/components/shared/payments/SettlementConfirmDialog.tsx` | SettlementConfirmDialog 当前实际调用表面；!!confirmRecord | 2 | 未查看 / 未执行 |
| 采购 | AppDialog / 弹窗 | `frontend/src/pages/reports/ReplenishmentQueryDialog.tsx:34` → `frontend/src/components/shared/AppDialog.tsx` | 查询补货建议；open | 1 | 未查看 / 未执行 |
| 采购 | WarehouseSelect / 选择器 | `frontend/src/pages/reports/ReplenishmentQueryDialog.tsx:68` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | CategoryTreeSelect / 选择器 | `frontend/src/pages/reports/ReplenishmentQueryDialog.tsx:80` → `frontend/src/components/shared/CategoryTreeSelect.tsx` | CategoryTreeSelect 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/ReportQueryFeedback.tsx:21` → `frontend/src/components/shared/QueryErrorState.tsx` | `${title}加载失败`；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 财务会计 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/reports/avg-cost-reconciliation.tsx:43` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 校正账面差异；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/avg-cost-reconciliation.tsx:97` → `frontend/src/components/shared/QueryErrorState.tsx` | 对账加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/avg-cost-reconciliation.tsx:99` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/reports/index.tsx:133` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DatePicker / 选择器 | `frontend/src/pages/reports/index.tsx:140` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/index.tsx:177` → `frontend/src/components/shared/QueryErrorState.tsx` | 报表加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | EmptyState / 状态表面 | `frontend/src/pages/reports/index.tsx:193` → `frontend/src/components/shared/EmptyState.tsx` | EmptyState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/index.tsx:209` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/index.tsx:224` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/index.tsx:249` → `frontend/src/components/shared/QueryErrorState.tsx` | 价格趋势加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | EmptyState / 状态表面 | `frontend/src/pages/reports/index.tsx:288` → `frontend/src/components/shared/EmptyState.tsx` | EmptyState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/index.tsx:304` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/index.tsx:329` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ProductFinderModal / 弹窗 | `frontend/src/pages/reports/index.tsx:346` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinderModal 当前实际调用表面；pickerOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | ReportQueryFeedback / 状态表面 | `frontend/src/pages/reports/inventory-aging.tsx:116` → `frontend/src/pages/reports/ReportQueryFeedback.tsx` | 存放明细；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/reports/inventory-aging.tsx:135` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ReportQueryFeedback / 状态表面 | `frontend/src/pages/reports/inventory-aging.tsx:138` → `frontend/src/pages/reports/ReportQueryFeedback.tsx` | 效期预警；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/reports/inventory-aging.tsx:139` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | InventoryAgingQueryDialog / 弹窗 | `frontend/src/pages/reports/inventory-aging.tsx:142` → `frontend/src/pages/reports/InventoryAgingQueryDialog.tsx` | InventoryAgingQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 财务会计 | Select / 选择器 | `frontend/src/pages/reports/kpi.tsx:109` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ReportQueryFeedback / 状态表面 | `frontend/src/pages/reports/kpi.tsx:123` → `frontend/src/pages/reports/ReportQueryFeedback.tsx` | 经营 KPI；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/kpi.tsx:170` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/pda-anomaly.tsx:91` → `frontend/src/components/shared/QueryErrorState.tsx` | PDA 异常分析加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Badge / 状态表面 | `frontend/src/pages/reports/profit-analysis.tsx:130` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Badge / 状态表面 | `frontend/src/pages/reports/profit-analysis.tsx:141` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | ReportQueryFeedback / 状态表面 | `frontend/src/pages/reports/profit-analysis.tsx:212` → `frontend/src/pages/reports/ReportQueryFeedback.tsx` | 利润 / 库存分析；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/profit-analysis.tsx:235` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/profit-analysis.tsx:246` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/profit-analysis.tsx:257` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/reports/profit-analysis.tsx:268` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/replenishment.tsx:221` → `frontend/src/components/shared/QueryErrorState.tsx` | 补货建议加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | DataTable / 表格状态 | `frontend/src/pages/reports/replenishment.tsx:229` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | Dialog / 弹窗 | `frontend/src/pages/reports/replenishment.tsx:242` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；confirmOpen | 1 | 未查看 / 未执行 |
| 采购 | ReportTable / 表格状态 | `frontend/src/pages/reports/replenishment.tsx:253` → `frontend/src/components/shared/ReportTable.tsx` | ReportTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 采购 | ReplenishmentQueryDialog / 弹窗 | `frontend/src/pages/reports/replenishment.tsx:278` → `frontend/src/pages/reports/ReplenishmentQueryDialog.tsx` | ReplenishmentQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 审批待办 | Badge / 状态表面 | `frontend/src/pages/reports/role-workbench.tsx:41` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | Badge / 状态表面 | `frontend/src/pages/reports/role-workbench.tsx:59` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | Badge / 状态表面 | `frontend/src/pages/reports/role-workbench.tsx:84` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | Badge / 状态表面 | `frontend/src/pages/reports/role-workbench.tsx:107` → `frontend/src/components/ui/badge.tsx` | Badge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | DailyWork / 导航/全局表面 | `frontend/src/pages/reports/role-workbench.tsx:155` → `frontend/src/components/shared/DailyWork.tsx` | DailyWork 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/role-workbench.tsx:167` → `frontend/src/components/shared/QueryErrorState.tsx` | 待办中心加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/warehouse-ops.tsx:113` → `frontend/src/components/shared/QueryErrorState.tsx` | 仓库运营看板加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | QueryErrorState / 状态表面 | `frontend/src/pages/reports/wave-performance.tsx:142` → `frontend/src/components/shared/QueryErrorState.tsx` | 批次效率加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/reports/wave-performance.tsx:203` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:67` → `frontend/src/components/shared/AppDialog.tsx` | type === 'purchase' ? '查询采购退货单' : '查询销售退货单'；open | 2 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:101` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | PickerField / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:113` → `frontend/src/components/shared/PickerField.tsx` | partyLabel；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | WarehouseSelect / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:123` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | PickerField / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:133` → `frontend/src/components/shared/PickerField.tsx` | 商品；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | OperatorSelectField / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:143` → `frontend/src/components/shared/OperatorSelectField.tsx` | 全部经办人；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:155` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:160` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | SupplierFinder / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:178` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；partyOpen | 2 | 未查看 / 未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:184` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；partyOpen | 2 | 未查看 / 未执行 |
| 销售 | ProductFinder / 选择器 | `frontend/src/pages/returns/ReturnQueryDialog.tsx:190` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productOpen | 2 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/pages/returns/index.tsx:318` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/returns/index.tsx:319` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/returns/index.tsx:324` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 2 | 未查看 / 未执行 |
| 销售 | OrderPrintOverlay / 弹窗 | `frontend/src/pages/returns/index.tsx:335` → `frontend/src/components/print/OrderPrintOverlay.tsx` | printTarget.returnNo；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | ReturnQueryDialog / 弹窗 | `frontend/src/pages/returns/index.tsx:343` → `frontend/src/pages/returns/ReturnQueryDialog.tsx` | ReturnQueryDialog 当前实际调用表面；queryOpen | 2 | 未查看 / 未执行 |
| 采购 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/returns/purchase/form/index.tsx:362` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | PickerField / 选择器 | `frontend/src/pages/returns/purchase/form/index.tsx:375` → `frontend/src/components/shared/PickerField.tsx` | 点击选择供应商…；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | WarehouseSelect / 选择器 | `frontend/src/pages/returns/purchase/form/index.tsx:386` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择仓库；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | select / 选择器 | `frontend/src/pages/returns/purchase/form/index.tsx:479` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | ProductFinder / 选择器 | `frontend/src/pages/returns/purchase/form/index.tsx:538` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finderOpen | 2 | 未查看 / 未执行 |
| 采购 | SupplierFinder / 选择器 | `frontend/src/pages/returns/purchase/form/index.tsx:546` → `frontend/src/components/finder/SupplierFinder.tsx` | SupplierFinder 当前实际调用表面；supplierFinderOpen | 2 | 未查看 / 未执行 |
| 采购 | StatusBadge / 状态表面 | `frontend/src/pages/returns/purchase/form/index.tsx:676` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | DataTable / 表格状态 | `frontend/src/pages/returns/purchase/form/index.tsx:726` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 采购 | ConfirmDialog / 弹窗 | `frontend/src/pages/returns/purchase/form/index.tsx:755` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认采购退货单；confirmOpen | 2 | 未查看 / 未执行 |
| 采购 | ConfirmDialog / 弹窗 | `frontend/src/pages/returns/purchase/form/index.tsx:764` → `frontend/src/components/shared/ConfirmDialog.tsx` | 取消采购退货单；cancelOpen | 2 | 未查看 / 未执行 |
| 销售 | PickerField / 选择器 | `frontend/src/pages/returns/sale/form/index.tsx:370` → `frontend/src/components/shared/PickerField.tsx` | 点击选择客户…；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | WarehouseSelect / 选择器 | `frontend/src/pages/returns/sale/form/index.tsx:381` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择仓库；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | select / 选择器 | `frontend/src/pages/returns/sale/form/index.tsx:475` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | ProductFinder / 选择器 | `frontend/src/pages/returns/sale/form/index.tsx:537` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finderOpen | 2 | 未查看 / 未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/returns/sale/form/index.tsx:544` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；customerFinderOpen | 2 | 未查看 / 未执行 |
| 销售 | StatusBadge / 状态表面 | `frontend/src/pages/returns/sale/form/index.tsx:751` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/returns/sale/form/index.tsx:802` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/returns/sale/form/index.tsx:833` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认销售退货单；confirmOpen | 2 | 未查看 / 未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/returns/sale/form/index.tsx:842` → `frontend/src/components/shared/ConfirmDialog.tsx` | 取消销售退货单；cancelOpen | 2 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/ReorderSourcePanel.tsx:21` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | RepeatCreateRecoveryPanel / 状态表面 | `frontend/src/pages/sale/RepeatSaleRecoveryPage.tsx:33` → `frontend/src/pages/sale/RepeatCreateRecoveryPanel.tsx` | RepeatCreateRecoveryPanel 当前实际调用表面；active | 1 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/pages/sale/SaleQueryDialog.tsx:68` → `frontend/src/components/shared/AppDialog.tsx` | 查询销售订单；open | 1 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:103` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | PickerField / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:115` → `frontend/src/components/shared/PickerField.tsx` | 客户；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | WarehouseSelect / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:125` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | PickerField / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:135` → `frontend/src/components/shared/PickerField.tsx` | 商品；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | OperatorSelectField / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:145` → `frontend/src/components/shared/OperatorSelectField.tsx` | 全部经办人；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:158` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | DatePicker / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:163` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:180` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；customerOpen | 1 | 未查看 / 未执行 |
| 销售 | ProductFinder / 选择器 | `frontend/src/pages/sale/SaleQueryDialog.tsx:185` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productOpen | 1 | 未查看 / 未执行 |
| 销售 | UnsavedBadge / 状态表面 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:253` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | RepeatCreateRecoveryPanel / 状态表面 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:274` → `frontend/src/pages/sale/RepeatCreateRecoveryPanel.tsx` | RepeatCreateRecoveryPanel 当前实际调用表面；reorder.source.active | 3 | 未查看 / 未执行 |
| 销售 | OrderEntryIssues / 状态表面 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:278` → `frontend/src/components/shared/OrderEntryIssues.tsx` | OrderEntryIssues 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | select / 选择器 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:447` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:592` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；h.customerFinderOpen | 3 | 未查看 / 未执行 |
| 销售 | CommercialPicker / 选择器 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:614` → `frontend/src/pages/sale/commercial/CommercialPicker.tsx` | CommercialPicker 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/sale/commercial/CommercialEditor.tsx:630` → `frontend/src/components/shared/ConfirmDialog.tsx` | 放弃当前草稿；discardOpen | 3 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/pages/sale/commercial/CommercialPicker.tsx:147` → `frontend/src/components/shared/AppDialog.tsx` | kind === 'kit' ? '选择成套配件' : '选择普通商品'；visible | 3 | 未查看 / 未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/sale/commercial/CommercialSalePage.tsx:426` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirm === 'cancel' ? confirmed ? '关闭剩余未发' : '取消订单' : confirm === 'reserve' ? '整单占库' : confirm === 'release' ? '释放整单占库' : '删除订单'；!!confirm | 3 | 未查看 / 未执行 |
| 销售 | CommercialShipDialog / 弹窗 | `frontend/src/pages/sale/commercial/CommercialSalePage.tsx:459` → `frontend/src/pages/sale/commercial/CommercialShipDialog.tsx` | CommercialShipDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | PrintPreviewOverlay / 弹窗 | `frontend/src/pages/sale/commercial/CommercialSalePage.tsx:468` → `frontend/src/components/print/SaleOrderPrintTemplate.tsx` | PrintPreviewOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/pages/sale/commercial/CommercialShipDialog.tsx:33` → `frontend/src/components/shared/AppDialog.tsx` | 安排本次发货；true | 3 | 未查看 / 未执行 |
| 销售 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/sale/components/AddressBookDialog.tsx:153` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 删除常用地址；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | AppDialog / 弹窗 | `frontend/src/pages/sale/components/AddressBookDialog.tsx:173` → `frontend/src/components/shared/AppDialog.tsx` | `常用地址${customerName ? ` · ${customerName}` : ''}`；open && guardAllowed | 3 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx:83` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 3 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx:95` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx:115` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx:143` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 4 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx:187` → `frontend/src/components/shared/QueryErrorState.tsx` | 没能加载占库预览，请重试后核对商品和仓库；由调用代码决定；需运行时触发 | 4 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx:195` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx:217` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 销售 | WarehouseSelect / 选择器 | `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx:230` → `frontend/src/components/shared/WarehouseSelect.tsx` | WarehouseSelect 当前实际调用表面；由调用代码决定；需运行时触发 | 4 | 未查看 / 未执行 |
| 审批待办 | nav / 导航/全局表面 | `frontend/src/pages/sale/components/SaleOrderPreview.tsx:69` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 审批待办 | QueryErrorState / 状态表面 | `frontend/src/pages/sale/components/SaleOrderPreview.tsx:82` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/pages/sale/components/ShipSelectDialog.tsx:63` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 3 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/components/ShipSelectDialog.tsx:74` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | input / 选择器 | `frontend/src/pages/sale/components/ShipSelectDialog.tsx:87` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | Dialog / 弹窗 | `frontend/src/pages/sale/components/StockShortageDialog.tsx:16` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 4 | 未查看 / 未执行 |
| 销售 | PickerField / 选择器 | `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx:74` → `frontend/src/components/shared/PickerField.tsx` | 点击选择客户…；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | WarehouseSelect / 选择器 | `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx:78` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择仓库；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx:90` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | Select / 选择器 | `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx:104` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ShippingProductField / 选择器 | `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx:119` → `frontend/src/components/shared/ShippingProductField.tsx` | ShippingProductField 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | AddressBookDialog / 弹窗 | `frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx:146` → `frontend/src/pages/sale/components/AddressBookDialog.tsx` | AddressBookDialog 当前实际调用表面；addrOpen | 3 | 未查看 / 未执行 |
| 销售 | select / 选择器 | `frontend/src/pages/sale/form/components/SaleOrderItemsTable.tsx:81` | 录入单位；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | UnsavedBadge / 状态表面 | `frontend/src/pages/sale/form/index.tsx:224` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | HandlingOperationPanel / 状态表面 | `frontend/src/pages/sale/form/index.tsx:237` → `frontend/src/pages/disposal/HandlingOperationPanel.tsx` | HandlingOperationPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | RepeatCreateRecoveryPanel / 状态表面 | `frontend/src/pages/sale/form/index.tsx:238` → `frontend/src/pages/sale/RepeatCreateRecoveryPanel.tsx` | RepeatCreateRecoveryPanel 当前实际调用表面；reorder.source.active | 3 | 未查看 / 未执行 |
| 销售 | OrderEntryIssues / 状态表面 | `frontend/src/pages/sale/form/index.tsx:241` → `frontend/src/components/shared/OrderEntryIssues.tsx` | OrderEntryIssues 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ProductFinder / 选择器 | `frontend/src/pages/sale/form/index.tsx:278` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；handling ? false : finderOpen | 3 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/sale/form/index.tsx:290` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；handling ? customerFinderOpen : customerFinderOpen && !frozen | 3 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | EditModeBadge / 状态表面 | `frontend/src/pages/sale/form/index.tsx:363` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | UnsavedBadge / 状态表面 | `frontend/src/pages/sale/form/index.tsx:363` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | OrderEntryIssues / 状态表面 | `frontend/src/pages/sale/form/index.tsx:378` → `frontend/src/components/shared/OrderEntryIssues.tsx` | OrderEntryIssues 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ProductFinder / 选择器 | `frontend/src/pages/sale/form/index.tsx:405` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finderOpen | 3 | 未查看 / 未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/sale/form/index.tsx:414` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；customerFinderOpen | 3 | 未查看 / 未执行 |
| 销售 | EditModeBadge / 状态表面 | `frontend/src/pages/sale/form/index.tsx:488` → `frontend/src/components/shared/EditModeBadge.tsx` | 改单中；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | UnsavedBadge / 状态表面 | `frontend/src/pages/sale/form/index.tsx:488` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | OrderEntryIssues / 状态表面 | `frontend/src/pages/sale/form/index.tsx:508` → `frontend/src/components/shared/OrderEntryIssues.tsx` | OrderEntryIssues 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ProductFinder / 选择器 | `frontend/src/pages/sale/form/index.tsx:534` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finderOpen | 3 | 未查看 / 未执行 |
| 销售 | CustomerFinder / 选择器 | `frontend/src/pages/sale/form/index.tsx:543` → `frontend/src/components/finder/CustomerFinder.tsx` | CustomerFinder 当前实际调用表面；customerFinderOpen | 3 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/sale/form/index.tsx:788` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/sale/form/index.tsx:862` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/sale/form/index.tsx:884` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/sale/form/index.tsx:952` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | EmptyState / 状态表面 | `frontend/src/pages/sale/form/index.tsx:970` → `frontend/src/components/shared/EmptyState.tsx` | 暂无装箱记录；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/sale/form/index.tsx:983` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 3 | 未查看 / 未执行 |
| 销售 | PrintPreviewOverlay / 弹窗 | `frontend/src/pages/sale/form/index.tsx:997` → `frontend/src/components/print/SaleOrderPrintTemplate.tsx` | PrintPreviewOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 3 | 未查看 / 未执行 |
| 销售 | ShipSelectDialog / 弹窗 | `frontend/src/pages/sale/form/index.tsx:1001` → `frontend/src/pages/sale/components/ShipSelectDialog.tsx` | ShipSelectDialog 当前实际调用表面；shipDialogOpen | 3 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | ReserveAllocationDialog / 弹窗 | `frontend/src/pages/sale/form/index.tsx:1011` → `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx` | ReserveAllocationDialog 当前实际调用表面；reserveDialogOpen | 3 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | ReleaseAllocationDialog / 弹窗 | `frontend/src/pages/sale/form/index.tsx:1017` → `frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx` | ReleaseAllocationDialog 当前实际调用表面；releaseDialogOpen | 3 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | StockShortageDialog / 弹窗 | `frontend/src/pages/sale/form/index.tsx:1023` → `frontend/src/pages/sale/components/StockShortageDialog.tsx` | StockShortageDialog 当前实际调用表面；!!shortageDialog | 3 | 未查看 / 未执行 |
| 销售 | QueryErrorState / 状态表面 | `frontend/src/pages/sale/index.tsx:284` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | DataTable / 表格状态 | `frontend/src/pages/sale/index.tsx:284` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | ConfirmDialog / 弹窗 | `frontend/src/pages/sale/index.tsx:296` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 1 | 未查看 / 未执行 |
| 销售 | PrintPreviewOverlay / 弹窗 | `frontend/src/pages/sale/index.tsx:308` → `frontend/src/components/print/SaleOrderPrintTemplate.tsx` | PrintPreviewOverlay 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 销售 | SaleQueryDialog / 弹窗 | `frontend/src/pages/sale/index.tsx:311` → `frontend/src/pages/sale/SaleQueryDialog.tsx` | SaleQueryDialog 当前实际调用表面；queryOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 销售 | StockShortageDialog / 弹窗 | `frontend/src/pages/sale/index.tsx:319` → `frontend/src/pages/sale/components/StockShortageDialog.tsx` | StockShortageDialog 当前实际调用表面；!!shortageDialog | 1 | 未查看 / 未执行 |
| 销售 | ReserveAllocationDialog / 弹窗 | `frontend/src/pages/sale/index.tsx:325` → `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx` | ReserveAllocationDialog 当前实际调用表面；!!reserveDialogOrderId | 1 | 未查看 / 未执行 |
| 打印物流 | AppDialog / 弹窗 | `frontend/src/pages/settings/barcode-print-query/BarcodePrintQueryDialog.tsx:36` → `frontend/src/components/shared/AppDialog.tsx` | 查询条码打印记录；open | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/barcode-print-query/BarcodePrintQueryDialog.tsx:70` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DataTable / 表格状态 | `frontend/src/pages/settings/barcode-print-query/index.tsx:514` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | BarcodePrintQueryDialog / 弹窗 | `frontend/src/pages/settings/barcode-print-query/index.tsx:525` → `frontend/src/pages/settings/barcode-print-query/BarcodePrintQueryDialog.tsx` | BarcodePrintQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 系统设置 | EditModeBadge / 状态表面 | `frontend/src/pages/settings/index.tsx:120` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | UnsavedBadge / 状态表面 | `frontend/src/pages/settings/index.tsx:121` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/settings/index.tsx:168` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | DataTable / 表格状态 | `frontend/src/pages/settings/pda-devices/index.tsx:159` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/settings/pda-devices/index.tsx:173` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；createOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 系统设置 | Select / 选择器 | `frontend/src/pages/settings/pda-devices/index.tsx:193` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/settings/pda-devices/index.tsx:220` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!secretView | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/settings/pda-devices/index.tsx:261` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；!!editing | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 系统设置 | EditModeBadge / 状态表面 | `frontend/src/pages/settings/pda-devices/index.tsx:266` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Select / 选择器 | `frontend/src/pages/settings/pda-devices/index.tsx:287` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/pages/settings/pda-devices/index.tsx:318` → `frontend/src/components/shared/ConfirmDialog.tsx` | 重置设备密钥；!!resetTarget | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/print-templates/editor.tsx:717` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 打印物流 | input / 选择器 | `frontend/src/pages/settings/print-templates/editor.tsx:929` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 打印物流 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/settings/print-templates/editor.tsx:1271` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | `切换到「${TEMPLATE_TYPES.find(t => t.value === next)?.label ?? next}」`；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/print-templates/editor.tsx:1910` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 打印物流 | select / 选择器 | `frontend/src/pages/settings/print-templates/editor.tsx:1954` | 须与打印机分辨率一致；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/print-templates/editor.tsx:1988` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 打印物流 | QueryErrorState / 状态表面 | `frontend/src/pages/settings/print-templates/index.tsx:84` → `frontend/src/components/shared/QueryErrorState.tsx` | 打印模板加载失败；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 打印物流 | DataTable / 表格状态 | `frontend/src/pages/settings/print-templates/index.tsx:85` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | ConfirmDialog / 弹窗 | `frontend/src/pages/settings/print-templates/index.tsx:92` → `frontend/src/components/shared/ConfirmDialog.tsx` | 删除模板；!!deleteTarget | 1 | 未查看 / 未执行 |
| 打印物流 | Dialog / 弹窗 | `frontend/src/pages/settings/printers/index.tsx:81` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；true | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/printers/index.tsx:430` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Dialog / 弹窗 | `frontend/src/pages/settings/printers/index.tsx:449` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；showAddDialog | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/printers/index.tsx:464` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | Select / 选择器 | `frontend/src/pages/settings/printers/index.tsx:481` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | DataTable / 表格状态 | `frontend/src/pages/settings/printers/index.tsx:524` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | BindDialog / 弹窗 | `frontend/src/pages/settings/printers/index.tsx:527` → `frontend/src/pages/settings/printers/index.tsx` | BindDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 打印物流 | ConfirmDialog / 弹窗 | `frontend/src/pages/settings/printers/index.tsx:536` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除；!!deleteTarget | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/sorting-bins/AssignSortingBinDialog.tsx:56` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/sorting-bins/SortingBinQueryDialog.tsx:39` → `frontend/src/components/shared/AppDialog.tsx` | 查询分拣格；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/sorting-bins/SortingBinQueryDialog.tsx:73` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/sorting-bins/SortingBinQueryDialog.tsx:86` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:60` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/sorting-bins/index.tsx:66` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | AssignSortingBinDialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:109` → `frontend/src/pages/sorting-bins/AssignSortingBinDialog.tsx` | AssignSortingBinDialog 当前实际调用表面；normalOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | AssignSortingBinDialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:113` → `frontend/src/pages/sorting-bins/AssignSortingBinDialog.tsx` | AssignSortingBinDialog 当前实际调用表面；handoffOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/sorting-bins/index.tsx:199` → `frontend/src/components/shared/BaseCrudPage.tsx` | 分拣格管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/sorting-bins/index.tsx:274` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | BatchDialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:297` → `frontend/src/pages/sorting-bins/index.tsx` | BatchDialog 当前实际调用表面；batchOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | AssignSortingBinDialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:299` → `frontend/src/pages/sorting-bins/AssignSortingBinDialog.tsx` | AssignSortingBinDialog 当前实际调用表面；assignOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | SortingBinQueryDialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:306` → `frontend/src/pages/sorting-bins/SortingBinQueryDialog.tsx` | SortingBinQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/sorting-bins/index.tsx:313` → `frontend/src/components/shared/ConfirmDialog.tsx` | 强制释放分拣格；!!releaseTarget | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/stockcheck/abc.tsx:154` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | confirmAction / 命令式确认弹窗 | `frontend/src/pages/stockcheck/abc.tsx:161` → `frontend/src/components/shared/GlobalConfirmDialog.tsx` | 切换仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/stockcheck/abc.tsx:189` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/stockcheck/abc.tsx:208` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | EditModeBadge / 状态表面 | `frontend/src/pages/stockcheck/abc.tsx:218` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | UnsavedBadge / 状态表面 | `frontend/src/pages/stockcheck/abc.tsx:219` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | input / 选择器 | `frontend/src/pages/stockcheck/abc.tsx:248` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/stockcheck/abc.tsx:277` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx:190` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx:294` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认提交盘点；submitConfirm | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx:303` → `frontend/src/components/shared/ConfirmDialog.tsx` | 取消盘点；cancelConfirm | 1 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/stockcheck/index.tsx:84` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Dialog / 弹窗 | `frontend/src/pages/stockcheck/index.tsx:87` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；createOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/stockcheck/index.tsx:93` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/stockcheck/index.tsx:108` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/stockcheck/index.tsx:125` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | CheckDetailDialog / 弹窗 | `frontend/src/pages/stockcheck/index.tsx:148` → `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx` | CheckDetailDialog 当前实际调用表面；!!detailId | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx:62` → `frontend/src/components/shared/QueryErrorState.tsx` | 退款来源核对失败；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx:74` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | Input / 选择器 | `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx:83` → `frontend/src/components/ui/input.tsx` | Input 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | select / 选择器 | `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx:84` | select 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | RefundRecoveryPanel / 状态表面 | `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx:98` → `frontend/src/pages/supplier-refunds/RecoveryPanel.tsx` | RefundRecoveryPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx:33` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open && scope.active | 1 | 未查看 / 未执行 |
| 财务会计 | RefundRecoveryPanel / 状态表面 | `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx:35` → `frontend/src/pages/supplier-refunds/RecoveryPanel.tsx` | RefundRecoveryPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | RefundRecoveryPanel / 状态表面 | `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx:36` → `frontend/src/pages/supplier-refunds/RecoveryPanel.tsx` | RefundRecoveryPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx:62` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；scope.active | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx:65` → `frontend/src/components/shared/QueryErrorState.tsx` | 原退款详情核对失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx:77` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | RefundRecoveryPanel / 状态表面 | `frontend/src/pages/supplier-refunds/RefundRecoveryPage.tsx:17` → `frontend/src/pages/supplier-refunds/RecoveryPanel.tsx` | RefundRecoveryPanel 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/supplier-refunds/index.tsx:48` → `frontend/src/components/shared/QueryErrorState.tsx` | 供应商退款加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | DataTable / 表格状态 | `frontend/src/pages/supplier-refunds/index.tsx:48` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | nav / 导航/全局表面 | `frontend/src/pages/supplier-refunds/index.tsx:49` | nav 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | RefundDetailDialog / 弹窗 | `frontend/src/pages/supplier-refunds/index.tsx:51` → `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx` | RefundDetailDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 财务会计 | RefundDetailDialog / 弹窗 | `frontend/src/pages/supplier-refunds/index.tsx:52` → `frontend/src/pages/supplier-refunds/RefundDetailDialog.tsx` | RefundDetailDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 财务会计 | Dialog / 弹窗 | `frontend/src/pages/supplier-refunds/index.tsx:53` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；scope.active | 1 | 未查看 / 未执行 |
| 财务会计 | QueryErrorState / 状态表面 | `frontend/src/pages/supplier-refunds/index.tsx:53` → `frontend/src/components/shared/QueryErrorState.tsx` | 原退款详情加载失败；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/suppliers/index.tsx:100` → `frontend/src/components/shared/BaseCrudPage.tsx` | 供应商管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/suppliers/index.tsx:137` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 基础资料 | SettlementTypeField / 选择器 | `frontend/src/pages/suppliers/index.tsx:182` → `frontend/src/components/shared/SettlementTypeField.tsx` | SettlementTypeField 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 基础资料 | input / 选择器 | `frontend/src/pages/suppliers/index.tsx:195` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:61` → `frontend/src/components/shared/AppDialog.tsx` | 查询调拨单；open | 1 | 未查看 / 未执行 |
| 库存仓储 | Select / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:95` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:110` → `frontend/src/components/shared/WarehouseSelect.tsx` | 全部仓库；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | PickerField / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:120` → `frontend/src/components/shared/PickerField.tsx` | 商品；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | OperatorSelectField / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:130` → `frontend/src/components/shared/OperatorSelectField.tsx` | 全部经办人；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:144` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | DatePicker / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:149` → `frontend/src/components/shared/DatePicker.tsx` | DatePicker 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/transfer/TransferQueryDialog.tsx:166` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；productOpen | 1 | 未查看 / 未执行 |
| 库存仓储 | EditModeBadge / 状态表面 | `frontend/src/pages/transfer/form/index.tsx:240` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | UnsavedBadge / 状态表面 | `frontend/src/pages/transfer/form/index.tsx:240` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/transfer/form/index.tsx:263` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择调出仓库；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | WarehouseSelect / 选择器 | `frontend/src/pages/transfer/form/index.tsx:275` → `frontend/src/components/shared/WarehouseSelect.tsx` | 选择调入仓库；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | ProductFinder / 选择器 | `frontend/src/pages/transfer/form/index.tsx:380` → `frontend/src/components/shared/ProductFinderModal.tsx` | ProductFinder 当前实际调用表面；finderOpen | 2 | 未查看 / 未执行 |
| 库存仓储 | StatusBadge / 状态表面 | `frontend/src/pages/transfer/form/index.tsx:441` → `frontend/src/components/shared/StatusBadge.tsx` | StatusBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/transfer/form/index.tsx:491` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 2 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/transfer/form/index.tsx:515` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 2 | 未查看 / 未执行 |
| 库存仓储 | DataTable / 表格状态 | `frontend/src/pages/transfer/index.tsx:259` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | ConfirmDialog / 弹窗 | `frontend/src/pages/transfer/index.tsx:263` → `frontend/src/components/shared/ConfirmDialog.tsx` | confirmState.title；confirmState.open | 1 | 未查看 / 未执行 |
| 库存仓储 | AppDialog / 弹窗 | `frontend/src/pages/transfer/index.tsx:273` → `frontend/src/components/shared/AppDialog.tsx` | 在途异常了结；forceCloseState.open | 1 | 未查看 / 未执行 |
| 库存仓储 | TransferQueryDialog / 弹窗 | `frontend/src/pages/transfer/index.tsx:315` → `frontend/src/pages/transfer/TransferQueryDialog.tsx` | TransferQueryDialog 当前实际调用表面；queryOpen | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/users/components/ResetPasswordDialog.tsx:36` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/users/components/UserFormDialog.tsx:146` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 系统设置 | EditModeBadge / 状态表面 | `frontend/src/pages/users/components/UserFormDialog.tsx:152` → `frontend/src/components/shared/EditModeBadge.tsx` | EditModeBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | UnsavedBadge / 状态表面 | `frontend/src/pages/users/components/UserFormDialog.tsx:153` → `frontend/src/components/shared/EditModeBadge.tsx` | UnsavedBadge 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Select / 选择器 | `frontend/src/pages/users/components/UserFormDialog.tsx:219` → `frontend/src/components/ui/select.tsx` | Select 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/users/components/UserFormDialog.tsx:239` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/users/components/UserFormDialog.tsx:252` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/users/components/UserFormDialog.tsx:276` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/users/components/UserFormDialog.tsx:294` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/pages/users/components/UserFormDialog.tsx:328` → `frontend/src/components/shared/ConfirmDialog.tsx` | ConfirmDialog 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | Dialog / 弹窗 | `frontend/src/pages/users/components/WarehouseScopeDialog.tsx:35` → `frontend/src/components/ui/dialog.tsx` | Dialog 当前实际调用表面；open | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/users/components/WarehouseScopeDialog.tsx:47` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | input / 选择器 | `frontend/src/pages/users/index.tsx:167` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | QueryErrorState / 状态表面 | `frontend/src/pages/users/index.tsx:179` → `frontend/src/components/shared/QueryErrorState.tsx` | QueryErrorState 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | DataTable / 表格状态 | `frontend/src/pages/users/index.tsx:182` → `frontend/src/components/shared/DataTable.tsx` | DataTable 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | UserFormDialog / 弹窗 | `frontend/src/pages/users/index.tsx:199` → `frontend/src/pages/users/components/UserFormDialog.tsx` | UserFormDialog 当前实际调用表面；formOpen | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 系统设置 | ResetPasswordDialog / 弹窗 | `frontend/src/pages/users/index.tsx:206` → `frontend/src/pages/users/components/ResetPasswordDialog.tsx` | ResetPasswordDialog 当前实际调用表面；resetOpen | 1 | 未查看 / 未执行 |
| 系统设置 | ConfirmDialog / 弹窗 | `frontend/src/pages/users/index.tsx:213` → `frontend/src/components/shared/ConfirmDialog.tsx` | 确认删除；!!deleteTarget | 1 | 未查看 / 未执行 |
| 系统设置 | WarehouseScopeDialog / 弹窗 | `frontend/src/pages/users/index.tsx:227` → `frontend/src/pages/users/components/WarehouseScopeDialog.tsx` | WarehouseScopeDialog 当前实际调用表面；!!scopeTarget | 1 | 未查看 / 未执行 |
| 库存仓储 | BaseCrudPage / CRUD复合表面 | `frontend/src/pages/warehouses/index.tsx:70` → `frontend/src/components/shared/BaseCrudPage.tsx` | 仓库管理；由调用代码决定；需运行时触发 | 1 | 已人工查看指定业务路径的代表状态 / 记录内限定交互已执行；其余状态/用方未执行 |
| 库存仓储 | input / 选择器 | `frontend/src/pages/warehouses/index.tsx:122` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 库存仓储 | input / 选择器 | `frontend/src/pages/warehouses/index.tsx:159` | input 当前实际调用表面；由调用代码决定；需运行时触发 | 1 | 未查看 / 未执行 |
| 系统设置 | PdaConnectionGate / 状态表面 | `frontend/src/router/index.tsx:100` → `frontend/src/components/pda/PdaConnectionGate.tsx` | PdaConnectionGate 当前实际调用表面；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| 系统设置 | ErpDesktopConnectionGate / 状态表面 | `frontend/src/router/index.tsx:107` → `frontend/src/components/erp/ErpDesktopConnectionGate.tsx` | ErpDesktopConnectionGate 当前实际调用表面；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| 系统设置 | PdaConnectionGate / 状态表面 | `frontend/src/router/pda.tsx:12` → `frontend/src/components/pda/PdaConnectionGate.tsx` | PdaConnectionGate 当前实际调用表面；由调用代码决定；需运行时触发 | 0 | 未查看 / 未执行 |
| 系统设置 | useDirtyGuardStore.getState().showConfirm / 命令式确认弹窗 | `frontend/src/router/workspaceHistoryGuard.ts:42` | 当前内容尚未保存，确定离开吗？；由调用代码决定；需运行时触发 | 0；壳层候选 | 未查看 / 未执行 |

## 未覆盖与遗漏边界

- AST 枚举当前注册与源码可达性。静态 import 链可能包含条件分支、组件能力或页面对象；relatedRoutes 是待核查候选，不能当作可见/已验收证据。
- 同组件多路径（退货、表单 new/detail、PDA list/:id、合并工作区）单列路由。仓库结构与 MergedPage 单列实际子页来源，其他业务分支仍须按参数/数据触发。
- 运行过的具体路径、表面和状态以 evidence/stateReview 为准；无证据的权限角色、网络延迟/失败、离线、禁用/完成/结果未知分支继续待验。无呈现线索的状态保留需运行时核实，不能断言缺失。
- JSX 高阶动态对象渲染、render-prop、注册表函数返回、Portal 和原生 Electron/Android 弹窗可有运行时表面；import 边及全部大写组件调用供人工补查。命令式确认识别 lib/confirm、showConfirm、window.confirm。
- source/line 只引用当前源码。definitionStateRef 指向 componentDefinitions 的文件级能力线索，可能包含多个导出；不证明每个调用传入了对应条件，也不证明能力在具体用方出现。
- 导航 hidden 指无顶栏/PDA ALL_OPS 注册。权限过滤、合并组去重、工作区子导航及条件来源按钮另有说明；不能推断普通员工一定可见。
- 别名与根/未知路径回退是独立待验表面；直接查看目标页面不能替代跳转验证。
- 未扫描后端、生产配置/.env、数据库数据、构建产物或 Android 原生工程；真实硬件扫码、打印、生产和发布证据不在本清单范围。
- 未从当前入口或 import 链可达的源码列入 excludedSources，不能按文件名当作产品模块；新增入口后复跑将自动纳入。
- 人工 actualView/issues/modified/verification/manual 字段按路由或调用签名 ID 保留；同类调用插入/顺序变化可能形成新 ID。reviewSourceSnapshot 须由验收者填写；生成脚本不自动宣布旧验收覆盖新源码。

未从现入口可达的文件（不是本清单产品表面）：

- `frontend/src/components/layout/keepAliveNavigationCases.tsx` — 未从当前注册页面、全局壳层或 main/router 入口静态可达；未列为已实现产品表面
- `frontend/src/pages/landing-preview/BusinessStory.tsx` — 未从当前注册页面、全局壳层或 main/router 入口静态可达；未列为已实现产品表面
- `frontend/src/pages/landing-preview/ProductDemo.tsx` — 未从当前注册页面、全局壳层或 main/router 入口静态可达；未列为已实现产品表面
- `frontend/src/pages/landing-preview/index.tsx` — 未从当前注册页面、全局壳层或 main/router 入口静态可达；未列为已实现产品表面
- `frontend/src/pages/logistics/components/TrackTimeline.tsx` — 未从当前注册页面、全局壳层或 main/router 入口静态可达；未列为已实现产品表面
