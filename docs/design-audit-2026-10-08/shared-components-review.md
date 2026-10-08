# 公共组件与供应商退款独立审查

审查基线 `66fa87e`，核对的是当前工作树，尚未提交或发布。审查者为 coverage_inventory；实施者分别为 root/A/B。此报告不把公共组件测试、import 可达或截图文件存在当成全部业务用方通过。

## 结论与已处理发现

当前审查未发现这批 DataTable、BaseCrudPage、statusTone 或供应商退款展示改动引入的新 P0/P1 阻断。发现并通知实施者的两个草稿保护缺口已修；仍保留其原因与证据，避免把缺口从审计记录中抹去。

| 发现 | 原因与影响 | 当前代码证据 | 验证边界 |
| --- | --- | --- | --- |
| P1：仅改变 Radix Select 无脏保护 | 原表单只有 fieldset；Radix Select 无 `closest('form')` 时不创建 BubbleInput，字段值变化不进入原生 change 捕获，取消可直接丢掉输入 | BaseCrudPage.tsx:199 的原生 form、fieldset 的 change 捕获；真实 SettlementTypeField 的 BubbleInput 行为测试 | 修改前用无 form 转换负控得到脏状态断言失败；当前真实组件仅选择改变、取消/继续编辑保留通过。测试通过真实 BubbleInput 的 native change 驱动，不宣称可见 Portal 键盘验收 |
| P1：programmatic Finder/Warehouse 回调未标脏且 pending 可迟到 | plastic-boxes 的商品选择回调不是原生表单 change；已打开 Portal 的回调也不能靠父 fieldset disabled 全部阻止 | BaseCrudPage 的第3参数 locked、第4参数 markDirty；plastic-boxes/index.tsx:203 的 PickerField/WarehouseSelect/Finder 均锁定、guard 和 markDirty | 代码调用链已核对；该业务完整 Finder 迟到回调仍需本用方 GUI/针对性测试，不能由共享 BubbleInput 测试推断通过 |

## DataTable 与11个备注调用方

`expandableText` 是可选列属性。当前11个定义均为 `remark`：transfer、accounting/tax、sorting-bins、returns（销售/采购两个路由共享）、inbound-tasks、finance/transactions、finance/expense-categories、payments/party-ledger、purchase、inventory、sale。商品名称、型号、单号和往来单位身份字段没有套入收起规则。

DataTable.tsx:135 仅对非空字符串渲染原生 details/summary，完整字符串仍在 DOM；空串和非字符串沿用旧 fallback。summary 有焦点样式、隐藏的展开名称，图标 aria-hidden；details 双击停止冒泡，避免误触行双击。当前这11个 remark render 都是文字或占位，未发现 summary 嵌套操作按钮。关闭时两行预览、展开完整文本的 CSS 与虚拟表已有 ResizeObserver 高度测量已核对。

DataTable 单测证明 DOM 完整文本、空值/非字符串 fallback 和双击不触发行；不证明浏览器原生 summary 键盘、实际 CSS 高度、长文本虚拟列表性能或11用方布局。Root 的销售备注截图/展开属于一个实际样本，其余用方仍待单独验收。

## BaseCrudPage 与8个业务用方

8个实际用方是 racks、suppliers、sorting-bins、plastic-boxes、locations、carriers、warehouses、finance/expense-categories。逐处核对了 create/edit/delete 权限传入；独立动作缺权时隐藏对应入口，保留可读行。原 renderRowExtra/custom renderActions 路径未被重写，内部 openEdit/openDelete 仍再查权限。

BaseCrudPage.tsx:126 对未保存输入及 pending 注册工作区 dirtyGuard；pending 时取消/Escape/遮罩/closeDialog 都保留原表单。隐藏页 late success 设置 saved 并保留原输入；返回后显示原结果、锁住再次提交，由用户关闭。原生 form 阻止默认提交，未增添新的提交路径。第三参数 locked 传到 Radix 与 Portal 控件；第四参数允许 programmatic 控件标脏。

独立 `BaseCrudPage.draft.test.tsx` 采用真实 BaseCrudPage、SettlementTypeField/Radix、React Query、TabPathContext、SectionVisibilityContext、dirtyGuardStore；只替代 toast 和缺失浏览器 API。6例分别覆盖仅选择变化后的取消保留、隐藏 pending-success 不自动关、pending 的 Escape/遮罩/取消/关闭保护、create/edit/delete 三个缺权组合。为避免全量并行下 Radix Portal 布局调度造成假超时，直接经真实 BubbleInput 的 native change 触发 Root 值变化；使用条件等待和同步 finally 清理，不提升全局 timeout。

这6例当前164ms，默认 timeout 通过。与 BaseCrudPage.feedback、DataTable、statusTone.contrast 合跑4文件41例通过，日志 `/tmp/flowcube-shared-independent-review-final.log`。根全量首轮的资源压力超时与后续级联曾存在，已修测试调度；本报告不把独立通过写成根全量已通过。

## ink tokens 与 statusTone

STATUS_TONE_CLASS 的 success/warning/danger/info 仅把前景改到对应 ink；原10%背景和20%边框保留，状态映射语义未变。对比测试解析实际 CSS HSL、转换 sRGB，检查 light/dark 下 background/card 与10%混合背景及 muted-foreground 在 background/card/muted 的4.5:1。类型新增 optional 属性不要求既有调用方改列。

此计算证明的是指定 token 和背景组合，不是94个原纯文本色用方的全部 alpha、disabled、浮层背景、语义或 GUI 通过。A/B 正在实施的 owned 文件需最后统一扫残留，不能把图标 `text-success` 与普通文字不加区分地全算缺陷。WorkspaceTabs 下拉的危险纯文本与关闭 hover 在 PDA 窗口结束后已换 ink，原4文件23例和 scoped ESLint 再次通过；该颜色微调的 GUI 未由本任务重跑。

## 供应商退款

列表/详情的供应商与仓库名称来自 purchase_returns 的 `supplier_name/warehouse_name`，已核对 returns-purchase.service.js:235 的原单快照插入；关联单号来自授权原采购/原退货 join。没有按当前主数据名称反推历史身份。未记录字段保留可读缺失说明和准确 ID，不造名称。

CreateRefundPage 的 source/账户读暂停仍由原 useRefundReadQuery 与 owner/activity/readable 守卫控制；submit 仍用原 operationUuid、requestKey、sourceFingerprint、排序分配及四位 BigInt 金额。新 submitted/displaySource 只保留原提交来源和金额：pending/completed/未知记录的 blocked 阻止重读与重复写；退出当前 owner 隐藏来源。不新增收款、不改变业务状态、数量或会计语义。

列表读失败明确 QueryErrorState，分页只在 list.ready 显示；首次详情读失败有持久错误/真实重试，已读详情保留原行与输入同时暂停写。详情动作仍需原状态、当前授权、ready、confirmAllowed，未知状态文字为“状态待核对”。凭证状态与实际回款事实分开显示，补凭证仍走原 API。

剩余验收边界：完整可分配来源、每一分配行与账户选择、详情 confirm/receive/cancel 权限与迟到回执、保留草稿、窄屏与键盘尚未由本审查者实际操作。Root 的 after 合成来源与列表/详情截图可另按具体记录合入；不能从界面变化和单测推导这些状态通过。新 QueryErrorState/SoftStatusLabel 等调用候选仍逐点列在 coverage。

## 边界纠正

退款 A 的46张 after 记录包括当时真实500持续错误与重试500。后来 AND AND 后端缺陷在真实库独立红到绿9例；统一重载后的退款成功列表/详情 GUI 仍需补证，不能重写历史截图为成功。

PDA 实际读取 API 是 `/warehouse-tasks/my` 与 `/my-sku-summary`；本批实际200。不存在的 `/my-tasks` 探测进入 `/:id` 的 NaN500，不能作为 PDA 页面失败。报表 API200只证明 API，不能替代图表/页面视觉验收。浏览器 HMR 对测试文件变更导致 document 更新也不得记为认证产品缺陷。

## 增量独立审查与证据（09:20）

八个BaseCrud真实用方44图逐张细看与限定草稿交互见 `base-crud-gui-validation.md`。塑料盒实际选商品+仓库及两种单独变化都确认保留；原继续编辑BODY回焦缺陷为P2实际失败，BaseCrud/基础Dialog已有自然红绿测试，fresh GUI追加前保持待验。当前基础Dialog/真实BaseCrud/A独立guard/WorkspaceTabs合跑4文件42例绿，scoped lint0；此前41例记录为较早的检查，不冒称根最终全量通过。

FinderTable新增grid/row/header/cell所属结构合法，按Arrow/Home/End移动真实行焦点，不自行选择；Enter走原onSelect，Space走原confirm，仍由FinderModal canConfirmRow控制读取中/失败不能确认。当前所有列render是身份或文本，没有发现新增嵌套编辑控件按键被吞。全部行tabIndex0不是roving模式，数据量大时仍需较多Tab；这是保留的键盘效率边界，未凭空声明axe违规。

QueryFormLayout自动列的230px最小宽限制与直接child min-w-0、col-span-2转full相配；当前实际用方直接span类均可匹配，未发现新增隐式列风险。实际CSS编译/窄尺寸仍按GUI，源码不是全查询表面通过。

SaleHeader的8字段Label与实例useId正确。条件发货产品仍固定sale-shipping-product的遗漏已报告P2：同一KeepAlive保留多个sf/deppon表头时ID重复，htmlFor可能指向隐藏旧实例。主任务新增双实例自然red→green并改为`${fieldId}-shipping-product`；本审查者核对当前双实例测试确实绑定各自parent，而非只查任意全局ID。合成环境无承运商，此条件分支尚无本任务GUI样本。

statusTone对比测试现在包含实际主按钮hover背景、PDA嵌套有效badge背景，并保持原10%状态底/20%边框合同。当前token计算不能代替所有alpha/业务背景或94纯文本用方视觉；disabled也不被写为4.5全验。

公共受控Dialog回焦扩展已同时覆盖ui/DialogContent与直接用Radix原语的AppDialog，抽成useDialogFocusReturn。AppDialog独立关闭回焦原实现自然red→green；当前上述真实组件4文件44例、7文件scoped lint0。显式BaseCrud/A草稿onCloseAutoFocus先执行，preventDefault后不被通用hook覆盖；失活/隐藏/断开目标不回焦。fresh GUI还未追加，不能把这44例等同全部弹窗现场通过。

A最终原固定67图已把客户退款正常200空/组合筛选/abort→真实重试及最终账款nav/ink补齐，原500截图历史不变。其后来新25图与独立草稿实施仍须明确最终报告才合入。B明确纠正picking前后均0SKU/暂无待拣商品的成功空态，不保留错误口述为历史页面失败。

## 最终增量独立审查

八主档44图与focus8图、供应商仅Radix/客户guard/采购1受控浮层3图均已逐张细看。原BODY持续回焦失败与fresh成功分开保留。最终canonical再补供应商可见Select仅变化、销售草稿真实close及取消回焦、768日期2→1→0共9图；本审查者after64图，具体限制在 observations-workspace-final.json / observations-c-final-shared.json / base-crud-gui-validation.md。塑料盒真实Finder选品+Warehouse选择的程序回调，以及各单独变化，实际触发确认、继续保留和放弃，不再属于尚未现场验证；其pending迟到回填仍主要组件夹具。

最终5文件47例（Dialog8、BaseCrud7、独立表单19、标签10、DatePicker3）通过，日志 /tmp/flowcube-dialog-focus-final-green.log；随后本任务8路径scoped ESLint exit0。root此前全量260文件1877例/tsc0/lint0error37warning的声明有独立日志，由root汇总；后续Description/选择列修正须另补受影响检查，不冒称该较早全量证明后改源码。

Radix版本升级后，1.1.19真实嵌套Dialog第一次Escape留两层，是自然产品行为失败；有限条件等待/真实focus没有修复。检查捕获监听注册表明isHighest在render计算、内层未注册最高层监听，1.1.13恢复事件时最高层判断，同时支持deferPointerDownOutside。最终canonical1.1.13+scope1.1.16真实8+Date3绿色，并用浏览器验证日期层次；保留1.1.19 red日志。原Date测试同步timeout与不支持:has-text CSS focus探针不是产品失败，不被混入红绿证据。

DataTable floor源码独立核对：百分比权重先归一化（原104亦保留相对关系），floor由每列权重与可读下限派生；持久像素列宽/拖动取消与提交、选择列宽、内部滚动和粘性操作保持原合同。源码及jsdom不能证明COL calc浏览器支持，所以当时明确要求真实layout。root已逐图看4fluid用方12图与4滚动右端/回左图，均无页面溢出；这些页面不带selection列。B真实selection夹具随后证伪calc导致Chrome均分、hover半透明透字，正在独占最小修复及新浏览器验证；修后结果必须另读B最终JSON，不把之前源码审查或4页图片升级通过。

另发现两个供应商退款DialogContent缺少对应Description目标，root真实最终axe0violations但2incomplete含此目标及focusguard检查；BaseCrud/CustomerForm也有源码Description警告，同样没有实际axe违规证据。已建议root让已有业务说明成为DialogDescription；没有说明的表单显式aria-describedby undefined。root已接受并对3文件最小收口，后续真实RF axe/组件回归由root记录。旧1contrast violation、此前0violation/2incomplete历史保持，不改成最新通过；未跑axe的其他用方不算已修或违规。

A固定67+41+11=119 after图已逐张声明并合入对应路径/状态；最终11图的模板400/重试、invoice abort后原接口200、有效日期未blur回焦以及物流名称属于override前样本。root真实登录4图、15末轮记录、ERP11具体资源/路径标题已合入；10dynamic仍是概览，只有合法procurement1代表详情细看。原report较早pending语句只代表当时快照，现状由本节及coverage具体evidence决定。没有新P0/P1源审查阻断；Description及selection这两个实际遗漏交由所属owner收口，等待其最新证据。

最终三处ARIA源已再独立核对：两个RF业务说明各自成为DialogDescription，由所属Radix自动descriptionId建立目标；BaseCrud/Customer只在无purpose说明的Content显式undefined，没有全局压掉合法Description。root第16条最新RF浅深逐图/真实Tab及ShiftTab/Escape回原单号button已合，浅深均37pass/0violations/1incomplete（aria-hidden-focus），不是全部axe通过。B当前源COL已换纯归一百分比、不透明sticky hover bg-muted；选择列最终布局仍以B真实Chrome样本为准。DatePicker现有合法解析/限期不变，内部Escape和焦点处理具当前47例及768两层GUI限定证据；未发现这三处改动引入新P0/P1。

B最终选择夹具正常reload后源已复核：60/20/20业务列、56px选择、表696px，Chrome实际384/127.984375/128.015625px；320内scroller286、scrollLeft0→410→0，checkbox正常勾选后滚动保留、header正常取消，hover为不透明rgb(241,245,249)。B最终5+2图均逐张声明细看；这里依B直接证据合入componentPreviews，不提升1150业务调用候选。无列DOM覆写的最终状态和初版calc均分/透明hover两个反例分别保留，403/未挂载属于harness；横轮CLI无事件/未移动，不当物理输入通过。两文件30例及三路径lint0/0为B记录，本审查只读源与证据未重跑浏览器。没有新增P0/P1发现。
