# 按影响排序的设计问题与实现结果

基线 `66fa87e`，实施工作树 `codex/impeccable-system-audit-20261008`。优先级表示用户影响，不把单测、源码或入口截图当作全部状态通过。前后原图保持独立；以下行号以最终源码为准，定位采用文件及组件名避免旧行号漂移。

| ID / 影响 | 相同语义的页面与现有差异 | 理解或操作成本 | 本轮采用的模式与代码位置 | 证据与验证边界 |
| --- | --- | --- | --- | --- |
| F01 / P1 | 客户退款、采购、客户、采购/销售退货、资金账户/流水、凭证、发票、打印模板，同为读取列表，部分异常显示空列表或共0，其他页显示持久错误 | 用户把未读到数据当成没有业务；错误重试入口不一致 | 复用 QueryErrorState，错误优先于空态，不显示旧统计冒充当前结果；各列表 index 与 `listReadFailure`、`financeListReadFailure`、`readFailureFollowup` 测试 | A before20图、after108图及末轮日志；真实请求 abort→原接口重试，模板真实400仍显示原错误；成功空态另列，不改成错误 |
| F02 / P1 | PDA收货/拣货/复核/打包及销售占库预览，在主读或附属读失败时仍可能展示旧任务/可用来源 | 已过期数据使下一步看似可执行；数量或阶段错误容易误操作 | PdaQueryError 区分主读/附属读，保留用户输入但暂停写；ReserveAllocationDialog 错误时指标—、来源表隐藏，原请求重试后再验证数量 | `implementation-b.md`、PDA readFailure测试、`evidence-b/sale-reserve-read-after.json`；没有因此确认占库或扫实物 |
| F03 / P1 | 同为主档维护，销售守新建权限，采购/部分主档提供无权限写入口；客户不同动作混用入口权限 | 填完才403，页面暗示岗位有能力 | 八个 BaseCrud 使用方与客户/采购按独立 create/update/delete/price 权限隐藏写入口；共享函数仍再检查 | `shared-components-review.md`、permissions专项；仅组件合成权限证明，逐角色GUI保留待验；未改变后端授权 |
| F04 / P1 | 主档、客户退款、发票、审批流及销售分配，同为提交在途，有些按钮禁用但Esc/X/遮罩、Portal回填或同帧连点仍能操作 | 旧回调关闭新草稿，重复提交或提交中改来源 | 同步 submission ref＋关闭守卫，捕获代次/当前页；BaseCrud及 useDialogDraftGuard、RefundDetailDialog、三种AllocationDialog | A/B/C自然红绿用例、延迟/隐藏回调夹具；pending真实业务写没有被截图代替 |
| F05 / P1 | 八主档与客户/用户/发票/审批流，同为未保存编辑，部分取消直接丢稿；Radix选择与程序回填不触发普通change | 用户无法沿用统一的返回/取消习惯 | 原生 form 捕获 change/input，Finder回填显式 markDirty；继续编辑/放弃修改，保留未blur日期；原409先复制再刷新保持 | `base-crud-gui-validation.md`、`a-followup-overlays.md`；真正输入→Esc→继续/放弃/重开，草稿代次及期间/幂等不变 |
| F06 / P1 | PDA各页同时存在扫码、数量、备注、原因等输入，全局键盘扫码可能夺普通字段内容；回填延迟在暂停状态仍落入页面 | 单手输入被抢、原因被扫码污染 | usePdaScanner 排除普通编辑字段，无缓冲Enter不回调；keyboard/native/delayed flush 均尊重 data-pda-scan-paused | 193项PDA组件回归、浏览器手输/取消；Android广播、相机、软键盘与真实条码枪未验 |
| F07 / P1 | 客户/供应商退款同为资金原操作，但未知结果、凭证状态、业务阶段和到账事实不能混成失败或统一成功 | 误重试会重复资金动作；错误理解实际到账 | 保留原 request key/operation UUID/fingerprint/receipt/recovery；供应商提交显示原来源和四位金额快照，只用于展示；业务阶段/凭证/回款分别呈现 | SupplierRefund专项300例，未知与小额夹具；没有重写库存、核销或确认规则；未作银行验收 |
| F08 / P1 | 客户退款原本应同其他限仓列表可读，但真实请求SQL出现 AND AND | 正常授权读也持续500，掩盖设计错误状态验证 | `backend/src/modules/refunds/refund-orders.service.js` 仅修已有scope片段连接；SupplierRefund DTO一次JOIN取原单身份快照和单号 | `a-backend-read.md`：独占实例自然3pass/2SQL失败→9pass；DTO红绿；无新增业务规则、无生产查询 |
| F09 / P2 | 销售表头、退款、账户、用户、发票、审批流、PDA设备、各查询，同为字段标签，部分控件无名称；同KeepAlive表头发货字段重复ID | 键盘/读屏难辨字段，标签可能指向隐藏页 | useId 与 htmlFor/aria-label；DatePicker输入先于日历图标，保留原日期解析；独立实例发货产品ID | 表单标签专项、双表头自然red→green；实际六表单及查询可访问树。日历打开时隐式label可能包含日历文案仍待进一步读屏验收 |
| F10 / P2 | 工作区标签与账款子视图同为当前位置，角色/名称及键盘行为不同 | 键盘需要猜当前页与关闭对象，误关草稿 | WorkspaceTabs合法tablist/owns，方向键/Home/End/Enter/Space，独立关闭按钮和dirtyGuard；账款导航aria-current | `workspace-tabs-validation.md`、23例键盘合同、真实三标签草稿切换；不改store和KeepAlive |
| F11 / P2 | 客户/供应商Finder同为查询选择，table行和cell缺合法所属；方向键不可复用 | 选择效率低、可访问树含义不清 | FinderTable合法grid/row/header/cell，箭头只移动焦点，Enter选中、Space确认仍走原准入条件 | Finder语义与原Customer/Supplier回归；ProductFinderModal是另一现存组件，不能据此自动通过 |
| F12 / P2 | 同语义状态/纯文本在不同背景和浅深主题对比不稳，深色主按钮hover与PDA叠加背景不合格 | 长时间辨色疲劳，状态不易读 | 既有成功/警告/危险/信息底色不变，新增对应 ink 文本变量；深色primary前景；94处文本用方协调改动 | 实际CSS+透明背景18对比测试；ERP/PDA代表axe及截图；计算不替代94用方所有背景、alpha与业务语义 |
| F13 / P2 | 销售、采购、库存等11备注列同为辅助长文，却把每行撑得很高 | 浏览数量少，难扫金额与状态 | DataTable可选expandableText，关闭两行、原生键盘展开完整备注；身份名称/型号/颜色/编码不收起 | 销售1440行高161→101、1024行高241→121，完整文字与双击合同测试；11用方逐状态尚未全部GUI复验 |
| F14 / P2 | 客户/供应商退款同为来源→金额→结果，供应商侧裸表格、内部ID与长段技术说明占主层级 | 员工依靠记ID辨原付款，动作与证据混杂 | SupplierRefund用既有PageHeader/DataTable/生成状态，供应商仓库身份、原采购/退货单号、四位金额和分配层级；内部ID按需保留，详情资金/凭证分开 | `design-baseline.md`、相同RF1前后1440/1024浅深截图；原资金日/20分页保留，没有伪造全量筛选 |
| F15 / P2 | 受控Dialog/AppDialog多数无Trigger，关闭回BODY；嵌套日期Esc可被外层重复处理 | 键盘回不到原操作，取消一层会丢查询窗 | useDialogFocusReturn共用，显式草稿handler优先，失活/隐藏/断开不抢焦；DatePicker保留输入与内层Escape；统一Radix layer/focus单例 | 真实AppDialog自然回焦red→green；最终5文件47焦点/草稿例与canonical销售查询真实2→1→0；SupplierRefund描述目标补齐，浅深axe0violation/1incomplete仍保留；旧同步超时与无效CSS探针不作为产品red |
| F16 / P2 | 补货计划多身份列明细的表头比其他宽表更容易逐字换行，数量/仓库选择控件无名称 | 表头高196px，数据被挤出视口 | `procurement/detail.tsx` 表头nowrap、保留原宽表水平滚动；选择与数量命名含商品/仓库 | 同PLAN1 1024浅深截图，表头196→44.5px，SupplyDetails只读/取消；未转换计划或保存规则 |
| F17 / P2 | 小于桌面推荐宽度时，比例表可压成逐字竖排 | 768窗口销售单行高超过260，操作/身份扫读费力 | 按有效列权重归一百分比，设置业务列96/操作128px可读下限，表内水平滚动；保留像素存储与拖动。真实Chrome选择列反例促成去calc；固定操作悬浮底色不透明 | 原始同资料768行高261→81px；四实际用方×768/1024/1440共12图与4次表内右端/回左复验，页面均无横溢出；2文件30组件例。带勾选列的真实Chrome最终复验另见B证据；不外推全部行状态 |

新增 P1 / SRE01（用户现场反馈）：销售列表和统一新单都在做“创建销售订单”，但 main 未接入原97bff81/d54dac6，仍有「新建销售」与「开单方式」两个选择，用户必须先判别普通/成套，且无法在主入口混排。已恢复当前 main 未提交工作区的原统一实现；位置为 `frontend/src/pages/sale/index.tsx` 主动作、`sale/form/index.tsx` 新建分支、`sale/commercial/CommercialEditor.tsx` / `newSalePayload.ts`，及成套资料/报价依赖。模式采用一个新建入口、同一明细两种选品；保留纯普通与含成套的不同后端模型、旧深链与已有恢复身份。前后截图、两张实际合成草稿、自然500与原请求恢复、2006例及未验证范围见[sale-entry-recovery.md](sale-entry-recovery.md)。该增量不扩展为全部销售执行业务通过。

合理差异：单据阶段与执行动作按业务保留；客户“执行退款”与供应商“登记实际已收到”不能互换；统计/全部筛选/分页各遵守原查询合同；金额和单价四位与数量两位各按原场景；ERP密集表格/键盘/多标签与PDA扫码/44px触控/下一步不同布局；无写权限仍保留合法只读。

本轮没有需要批准的业务规则改动。合成实例迁移带来的旧标签模板格式被现校验真实400拒绝，当前只修错误呈现；若另行处理旧模板隔离/格式迁移，须独立确定范围，不能由本地夹具推断生产同样存在。合成账户普通4元付款与测试勾稽不作为真实账务异常或改规则理由。
