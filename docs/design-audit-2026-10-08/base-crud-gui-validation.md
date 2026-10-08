# BaseCrud 八用方与公共弹窗焦点

本审查者使用命名会话 `flowcube-impeccable-crud`、同一 context/tab、本批专属临时 API50060 与 Vite5186 的合成全权账号。只打开、输入、选择、取消与放弃前端草稿，没有创建、修改、删除、释放或打印业务资源。原观察存于 `observations-crud-after.json`；截图44张已通过 view_image 逐张细看，不以接触表缩略图代替。

| 路径 | 实际交互与布局 | 明确保留边界 |
| --- | --- | --- |
| `/suppliers` | 1440/1024打开；Tab圈内；长表单内部滚动到末尾；代表输入→Escape确认→继续保留→放弃关闭→重开恢复初态 | 创建/编辑提交、pending/权限GUI未验；可见Radix仅选择后续补验见末节 |
| `/carriers` | 两尺寸字段/分组/平台说明与页脚可读；Tab、输入、确认保留、放弃、重开 | 平台绑定/月结/取号/打印未执行 |
| `/warehouses` | 两尺寸名称/联系人/地址/备注可读；Tab、输入、确认保留、放弃、重开 | 仓库范围/创建写入未执行 |
| `/locations` | 两尺寸仓库与位置编码/容量/备注/页脚可读；同草稿交互 | 编码生成、库位创建/打印未执行 |
| `/racks` | 两尺寸仓库、扫码校验说明与位置/数量/备注/页脚可读；同草稿交互 | 未输入条码查询或创建/标签打印 |
| `/sorting-bins` | 两尺寸编号/仓库/备注/页脚可读；同草稿交互 | 批量创建、补分配、释放未执行 |
| `/finance/expense-categories` | 两尺寸名称/排序/备注/页脚可读；同草稿交互 | 未提交/停用/删除/影响既有报销 |
| `/plastic-boxes` | 实际打开Finder确认商品+选择仓库，Escape确认→继续两值保留；仅商品、仅仓库各自变化均真实触发确认并保留；放弃、重开回空；两尺寸Tab圈内 | 未创建；Portal late callback/pending仅源码/单测层，非实际业务pending |

短表单的实际 clientHeight=scrollHeight 不需要内部滚动，未伪造滚动效果。供应商长表单记录了实际 scrollTop；1024字段和页脚并未被外层裁掉。货架少量内容高度差的图中页脚可读，不宣称额外滚动状态全面验收。塑料盒实际选品是独立ProductFinderModal实现，不能由通用FinderTable最新grid语义修改推广其键盘验收。

## 实际发现与红绿验证

八用方原“继续编辑”都保留草稿，但确认浮层完全卸载且动效稳定后 `document.activeElement` 为 BODY。现场需重新聚焦字段后再Escape；这一人工恢复操作保留在原观察里，没有写成回焦通过。

BaseCrud 增加仅在继续编辑时恢复原字段的 onCloseAutoFocus：表单仍活动、字段仍连接且属于原dialog时才回焦，否则回原form容器；放弃不回已移除字段。AppDialog/ConfirmDialog 仅转发可选回焦事件，不改布局。新增真实BaseCrud/真实Radix用例自然红（原字段与BODY断言失败）→绿；日志 `/tmp/flowcube-basecrud-focus-red.log`、`/tmp/flowcube-basecrud-focus-green.log`。原7例同时覆盖真实BubbleInput、隐藏pending-success、pending关闭保护与逐动作权限，不把该测试称作可见Portal或八用方业务GUI验证。

主任务随后实际采购计划1的“需求与覆盖”受控浮层无 DialogTrigger，Escape也落BODY；因此 ui/dialog.tsx 增加统一回焦能力。进入FocusScope前记原HTMLElement；关闭先让调用方handler处理，未preventDefault才恢复connected/非disabled/非hidden/inert/display:none/visibility:hidden的原元素。Section失活时阻止回旧页，不改变布局，不重做store。显式草稿handler仍保有回焦归属。

独立真实Radix测试的无Trigger与nested用例自然红（2fail/4pass）→绿；当前7例含标准Trigger、隐藏Trigger、失活页、显式handler。与BaseCrud、A独立草稿、WorkspaceTabs合跑4文件42例全部通过，日志 `/tmp/flowcube-dialog-focus-red.log`、`/tmp/flowcube-dialog-focus-green.log`。6文件 scoped ESLint 0。公共Dialog与BaseCrud修复后的fresh GUI仍待本报告追加；不由组件测试自动宣布现场成功。

09:24补查发现AppDialog直接使用Radix Content原语，不能只修改ui/DialogContent。新增AppDialog受控用例先在真正的关闭回焦断言自然红（1fail/7pass），再将上述行为抽成 `useDialogFocusReturn` 供两种Content共用，不改变任何布局或自定义handler优先级。当前8个公共焦点例与BaseCrud/A独立草稿/WorkspaceTabs合跑4文件44例通过，7文件 scoped ESLint 0；日志 `/tmp/flowcube-appdialog-focus-red.log`、`/tmp/flowcube-dialog-focus-green.log`。较早42例记录不覆盖这次追加，后者为当前最小回归证据。

## 资源与环境边界

失败的两次脚本尝试已保留为 harness 尝试：一次过早等待动效/遮罩，一次CLI不支持find nth focus；纠正后完成实走，不记产品失败。每次错误退出自有session close，塑料盒完成后亦close，session list确认本任务不在活跃列表。

主任务真实UI logout曾撤销共享合成token，随后重新登录并重启同一Vite seed；旧context若401属于测试环境操作，不记产品认证缺陷。fresh回焦/草稿标签关闭将在重新开的同名自有context执行。Android/Electron/物理打印、真实写操作pending、全部状态与权限、CI/部署均未由本报告验证。

## 当前源码 fresh 回焦复验

共享源码稳定后重新开同名自有context，逐项实走八个用方，记录在 `observations-focus-after.json`。七个普通表单代表字段输入→Escape确认→继续编辑，均回到刚才的同一个原始INPUT并保留值；随后Escape放弃关闭，均回到原新增按钮。塑料盒真实Finder选品和仓库Select选择后，同样确认→继续，两值保留且焦点回原仓库combobox，放弃后回原新建塑料盒按钮。没有保存、创建或业务写入。

八张 `c-focus-*-resume-1024.png` 已逐张实际查看，1024×900浅色。它们证明指定回焦/保留交互和字段焦点环，未重跑1440、深色、pending或权限GUI。原44图和BODY失败保持历史记录，不被成功复验改写。当前ProductFinder仍是独立的ProductFinderModal表格；通用FinderTable的grid/方向键修改不能由这次选品推广到全部选品实现。

本轮脚本探索中，等待main而新增入口尚未挂载、跨页关闭动效遮罩、旧选择器将真实table row当显式`[role=row]`、DOM对象直接返回导致CDP序列化失败均属于探针/时序失败，未操作业务资源；正确等待当前标题/入口、动画稳定并使用真实tr后完成验收。每次退出均关闭本任务context；最后 `agent-browser session list --json` 仅root，无本任务会话。

另三张 `c-focus-procurement-open`、`c-focus-supplier-select-only-resume`、`c-focus-customer-resume`1024图也逐张细看，见 `observations-focus-extras.json`。采购1实际需求与覆盖浮层Tab后Escape，关闭并回到原打开按钮；供应商只通过可见Radix把月结改现结，没有改普通input，Escape确认→继续保留现结并回原combobox→放弃；客户新增备注变化Escape→继续保留备注并回原字段→放弃，公共FocusReturn与独立草稿自定义handler兼容。都未保存或触发业务写入。

此11张fresh焦点图发生于根将Radix旧顶层1.1.11/1.1.7 singleton统一到已有锁中新版之前；之后将针对日期和草稿关闭补关键复验，不称依赖最终版全系统验收。销售两商品关闭复验在选品初载时被旧遮罩覆盖的尝试退出，无关闭结论，后续另列。最后close及list确认无本任务会话，当时只有root与A。

## 最终canonical关键样本

最终 dismissable-layer1.1.13 / focus-scope1.1.16 下又实际走供应商仅Radix月结→现结，Escape确认、继续编辑保留现结并回原combobox、再Escape放弃关闭，未输入普通字段、未保存。1024×900图已人工细看，见 observations-c-final-shared.json。Select选项退出时先等待原combobox恢复焦点，再保存原target；提前保存旧Portal选项的条件等待超时属于无效探针，观察当时焦点本已在原combobox，未当产品失败。第一次过早点击被关闭遮罩覆盖亦保留为时序尝试，正确等待可交互后完成。

同文件另外有768销售查询日历两层→Escape一层且原日期input/合法值保留→Escape全部关闭回原查询按钮的两张人工细看图，及工作区取消关闭返回原close按钮一图；实际等待自动回焦完成。此前11张属于override前，最终4张仅这些关键样本，不提升其余7主档为最终依赖全部现场验证。工作区两商品草稿完整关闭见 workspace-tabs-validation.md。

本审查者after总计64图：原8用方44图、focus8图、extras3图、最终销售草稿5图、canonical关键4图，全部逐张实际查看。最终Context finally close，独立list仅root/B，无本任务会话。后续Description属性收口与DataTable变化另由新证据绑定，不重写当前图。
