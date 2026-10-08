# Assessment B：技术设计质量独立审查

日期：2026-10-08。基线：`66fa87e`。审查者 B 未读取 Assessment A。本文记录实施前的独立判断；后续修整、回归与未覆盖项另行记录，不能用本文的建议代表已经修复。

## 方法与证据边界

已阅读仓库约束、`docs/frontend-pda-conventions.md` 和 impeccable 的 audit、critique、product 指引。当前 impeccable 是 Lite manual port，`detect.mjs`、live server 与 overlay 不可用，按 SKILL 明确允许跳过脚本，使用源码、实际浏览器交互及 axe 补充检查。没有运行上游 detector，也没有把 axe 当成全面 WCAG 验收。

源码覆盖 PDA 路由树中的 26 个页面组件、路由权限/设备水合与共用扫码、反馈、状态、操作区；ERP 覆盖 tokens、Button/Input/Select、DataTable/VirtualTableBody、AppDialog、PageHeader、QueryFormLayout、PickerField、CategoryTreeSelect、WarehouseSelect、商品 Finder、WorkspaceTabs 与代表表单调用方。性能只审查结构与边界，没有设备性能剖析。

浏览器使用专属会话 `flowcube-impeccable-b`、专属临时 API/数据库、合成员工及合成设备。ERP 与 PDA 使用不同标签页。ERP 代表尺寸 1440×900 与 1024×768；PDA 390×844、320×844。仅导航、查看、输入和取消；未提交库存、业务单据、打印或更新。登录页因既有认证被 GuestRoute 跳转，初轮作业页因尚未绑定设备仅验证设备门；后续绑定遍历证据另见 `observations-pda-before.json`。Android 广播扫码、相机、软键盘、打印与实体返回键尚未验证。

暗色检查通过临时添加 `.dark` 后立即恢复，用于验证 token 兼容性；源码没有发现用户可操作的主题切换入口，因此不能称为主题切换功能验收。源码行号均以审查基线为准，后续改动可能移位。

## 技术评分（代表检查，非全系统验收）

| 维度 | 分数 | 依据 |
| --- | ---: | --- |
| 可访问性 | 1/4 | 实际键盘 Enter 被扫码监听阻止；代表 ERP Select 缺名称；对比度、弹窗焦点与 live status 有缺口 |
| 性能结构 | 3/4 | 分页、懒加载、虚拟表与稳定扫码 listener 已有；未做长任务、真机或大数据性能测量 |
| 响应式 | 2/4 | 代表 ERP 1024、PDA 320 可达；窄弹窗网格、短屏自绘弹窗和长标识仍需处理 |
| 主题一致性 | 1/4 | semantic tokens 已有，但 PDA 白底与正文 token 冲突；小字号状态色不满足正文对比 |
| 产品设计约束 | 3/4 | 既有查询/读写/恢复边界清晰；局部指标卡、触控尺寸和不真实的读取状态削弱一致性 |
| 合计 | 10/20 | 未将仅有截图或未触达页面计为通过 |

## 优先发现

### B-01 / P1：读取失败被呈现为加载、不存在或空数据

证据：`pages/pda/receive.tsx:593,608`、`transfer-out.tsx:29,74`、`transfer-in.tsx:35,95` 仅消费 `data/isLoading`，`!data` 进入持续加载；`sale-return-receive.tsx:33,134`、`sale-return-putaway.tsx:39,106`、`stockcheck.tsx:91,162` 会在请求失败后显示“任务/盘点单不存在”；`sort.tsx:127,318` 将失败后的 `bins ?? []` 当作“暂无分拣格”；`pack.tsx:411,979` 的 packages 请求错误可能显示“新建箱子开始打包”。`task.tsx:235,411` 虽读取 error，但错误没有独立渲染，扫码条也未随首次读取失败明确受限。

影响：操作者无法区分网络/权限失败与真实业务事实，可能离开原任务或尝试创建新箱；无重试入口会中断恢复。相反，inbound、transfer、sale-return 列表以及 adjustment/cancel-return 详情已使用 `PdaQueryError`，可复用既有语义。

方案：每个读请求消费 error/refetch；初始失败显示明确失败与重试，成功空结果才呈现空态。分拣格、包裹列表等次级读失败也必须单独呈现。恢复回执、草稿与原单据 ID 不清空、不自动提交，后台状态规则不修改。验证应实际拒绝初始/次级请求并确认不存在误导文案和可提交入口。

### B-02 / P1：全局扫码 Enter 取消焦点按钮的键盘操作

证据：`hooks/usePdaScanner.ts:handleKeyDown` 只排除带 `data-scanner-manual` 的 INPUT 和 TEXTAREA，任何其他目标的 Enter 都执行 `preventDefault()` 与 flush。独立浏览器绑定页：焦点放在“扫码失败？可手动输入设备码和密钥”，Enter 后面板仍关闭；Space 后面板打开。该证据不需要业务写入。

影响：依赖键盘、开关控件或辅助技术的操作员无法用 Enter 激活按钮；未明确标记的人工数量字段也可能被识别为扫描输入。

方案：保留无焦点扫码与双来源去重，同时忽略普通人工输入/内容编辑及无扫描缓冲时的交互按钮 Enter；不以按键替代未知回执核对。以真实 DOM keydown 回归验证按钮 Enter 不被取消、人工数量输入不进入扫码、快速条码+Enter 仍只提交一次。

### B-03 / P1：合法小数数量被取整显示

证据：`components/pda/PdaHeader.tsx:79` 进度的 current/total，`pages/pda/task.tsx:101` 已拣/共需，`pack.tsx:115,826,936` 件数与完工说明，`ship.tsx:279,316` 总件数与逐箱件数使用 `.toFixed(0)`。

影响：合法 1.25 件会显示为 1，实际已拣与需求也可能同时显示同一个整数，不能作为作业判断依据。百分比、真实箱数仍可取整数。

方案：统一调用已有 `lib/format.ts` 的 `qty`，保留最多两位数量精度；不改变 API、库存、金额或数量校验。用分数需求/已拣的实际组件渲染回归确认展示完整。

### B-04 / P1：关键 PDA 浮层缺焦点边界，后台扫码未统一暂停

证据：`PdaOverReceiveDialog.tsx:46` 与 `PdaUpdateDialog.tsx:117` 使用自绘 fixed div；没有 dialog role、标题关联、焦点约束和短屏内部滚动。超收原因按钮只有颜色选择态，无 radio/pressed 语义。`layouts/PdaLayout.tsx` 将更新弹窗置于 Outlet 的兄弟节点，而 `usePdaScanner` 原生与键盘入口仅看各页面 enabled，更新浮层未作为统一暂停条件。

影响：超收涉及应付变化，读屏与键盘可能仍访问背景；更新通知遮盖任务时仍可能接受原生扫码。短屏/字体放大下关键原因与操作区可能难以同时触达。此项尚未完成真实浮层视觉/原生验证。

方案：PDA 专用 Radix Dialog 壳统一语义、焦点、内部滚动、固定操作区，强制原因仍默认不选、确认仍禁用；统一扫描暂停 context 覆盖原生和键盘回调。不得改变强制更新/财务确认/原请求恢复规则。

### B-05 / P1：正文、状态与暗色兼容对比度缺口

证据：基线 `index.css` muted foreground 对 background 为约 4.43:1，对 muted 为 4.34:1。`lib/statusTone.ts:22–32` 将 success/warning/info 动作色直接作 12px 状态文字，light 卡片上的 `/10` 混色约 2.95/2.87/3.54:1；dark warning/destructive 约 3.81/3.14:1。计算使用基线 HSL 转 sRGB 和实际 alpha 混色，不是仅比较 token 名称。

`PdaHeader.tsx:44` 硬 `bg-white` + title 的 `text-foreground` 在模拟 dark 时实际白底与 rgb(248,250,252) 白字冲突（见 `b-pda-bind-dark-simulated-320.png`）；PdaSection/PdaStat 同样硬白底，调用方包括 ship、pack。21 个 PDA 页面有 slate/blue/green 等硬色，不代表每一处都失败，需要按文字角色逐处核对。

方案：保留动作背景；增加可读 semantic ink/surface/border 角色，并统一状态文字使用 ink。PDA Header/Section/Stat/Scanner 使用语义 surface 与 foreground，测试两主题真实相邻背景与 placeholder。公共 tokens 由主 agent 负责，PDA 仅接入。

### B-06 / P1：表单标签未与控件关联

证据：`SaleOrderHeaderFields.tsx:1–145` 的仓库、承运商、运费 SelectTrigger 没有可访问名称。`sale-new-axe.json` 独立浏览器报告 3 个 button-name critical。大量可见 Label 没有 htmlFor/id。PDA 的 split 数量模式、stockcheck 实盘、receive 批次/日期、退货质检数量、bind 手动设备凭据及 PdaScanner 手动输入多用 placeholder/span，缺持久关联；退货箱数的 +/− 无“添加/删除箱子”名称。

方案：使用 useId 关联 Label 与输入/选择器，错误通过 aria-invalid/describedBy 关联；每个操作有可读名称。保留 headerReadOnly、日期和数量规则。凭据不写截图/报告；绑定完成仍清空输入。

### B-07 / P2：反馈的可读时间和公告语义不足

证据：`PdaFlash.tsx:29` 普通 div 没有 status/alert/live。`usePdaFeedback` 默认 ok1500ms、err2500ms、warn2000ms；重要错误解释随计时消失。PdaCriticalActionNotice 与网络条缺公告语义。

方案：成功/一般警告以 status 宣告，阻断性错误以 alert 宣告并保留至明确处理或下一动作；恢复原结果须持续可见。避免新增重复 toast，避免因宣告触发自动提交。

### B-08 / P2：PDA 控件尺寸和禁用原因不统一

证据：PdaCriticalActionNotice/PdaSplitRecoveryPanel 的 `size="sm"` 36px；stockcheck 实盘 Input h7=28px；split 模式按钮约28px；bind 手动展开按钮约20px；部分默认 Button40px。PdaScanner 的所有 disabled 状态都画 spinner 与“正在处理扫码结果…”，但调用方也用 disabled 表达等待核对、完成、离线等。

方案：局部 PDA 主动作48px、必要触控至少44px，不整体放大 ERP；小型选项用真实 pressed/checked 状态。扫码条区分 busy 与 blocked 文案，完成/待核对不伪装为处理；焦点可见，减少运动提供 motion-reduce 替代。

### B-09 / P2：窄弹窗及操作数据的响应式仍须进一步适配

证据：`QueryFormLayout.tsx:5` 无窄屏断点的两列 grid，AppDialog 可收窄至95vw，但 paired 日期/状态仍保持两列；PdaOverReceiveDialog 无内部滚动。`ship.tsx:275` 把任务号、客户、仓库当作大号 PdaStat，长标识在两列中难以阅读。AppDialog 的拖动/缩放句柄目前仅 pointer/mouse；DataTable 调列顺序也只有拖放，没有可键盘操作替代（列宽按钮已有 Arrow/Enter，属正向基础）。

方案：查询窄屏单列、操作区换行；身份信息使用可完整换行的标签/值，数字统计保留用于数量；对拖动提供 keyboard/menu 替代。Finder1024的横向滚动是已有完整表格策略，不能误判为截断，也不能把商品身份改成省略号。

### B-10 / P2：工作区与 Finder 的语义结构不完整

证据：WorkspaceTabs tab 没有 tablist 父节点，role=tab 节点缺键盘焦点/导航且嵌套关闭按钮；axe 验证 aria-required-parent 5、nested-interactive 4。FinderTable 用 div header 和 role=row，但缺 table/grid parent 和 cell 语义。PdaHeader 主标题为 p 而非页面 heading。

方案：保持工作区/选品现有状态与选择规则，补充 tablist、方向键、焦点与关闭按钮关系；Finder 使用正确 table/grid 语义，选中状态可读；PDA 页面建立一层主 heading。WorkspaceTabs由另一实施者负责，B不覆盖其文件。

## 代表实际观察

| 场景 | 实际结果 | 证据/边界 |
| --- | --- | --- |
| 库存列表/查询 | 1440、1024查询字段与操作可达；过滤弹窗可取消 | b-inventory-1440、b-query-1440/1024；只读 |
| 仓库结构/新建库位 | 1024字段、选择器及取消可达 | b-locations-1024、b-location-form-1024；没有保存 |
| 设置编辑态 | 1024进入编辑、取消回只读 | b-settings-1024、b-settings-edit-1024；没有改值 |
| 商品Finder | 1440/1024完整宽表、横向滚动、取消可达 | b-product-finder-1440/1024；未选商品 |
| PDA绑定/手动扫码 | 390/320未出现页面横向溢出；明确手动按钮后才有输入焦点；输入合成文本后取消 | b-pda-bind-manual-390/320、b-pda-scanner-filled-320；未扫码提交 |
| PDA键盘按钮 | Enter被阻止，Space可展开绑定手动区 | B-02；实际交互 |
| PDA模拟dark | Header标题失读 | b-pda-bind-dark-simulated-320；兼容性模拟，随后恢复 |

axe 原始输出保存在 `evidence-b/`，包含 location-form、sale-new、product-finder、pda-bind-manual。违反节点数量不能相加当作独立缺陷数量；Radix 背景 aria-hidden-focus incomplete 不当作确定缺陷。

## 保留的既有约束

稳定请求键、原结果核对、重复扫码去重、人工输入显式开启、设备/权限门、读取失败已有重试组件、完成态独立界面和 KeepAlive 可见性机制均有可复用基础。修整不得清除未知结果草稿、不自动重试写操作、不跳过后端范围/状态校验、不把完成截图称作库存真机验收。

B 浏览器作业已结束并核对本会话退出。实施、代表实际观察、13 个动态详情未覆盖原因、开发服务器 reload 边界与验证结果见 `implementation-b.md`、`observations-pda-after.json`；本文仍保留实施前独立判断，不将代表截图升级为全系统通过。

后续主 agent 另分配销售 `ReserveAllocationDialog`、`ReleaseAllocationDialog`、`ShipSelectDialog` 的两位数量提示、pending关闭/编辑/连点守卫及占库预览失败/仓库标签修整。此增量及3文件16测试、独立真实读/输入/取消样本记于 `implementation-b.md` 与 `evidence-b/sale-allocation-after.json`，不回写或改变本报告的初始独立判断。
