# UI 审计修复执行记录

来源：[核查后的修复计划](2026-10-27-ui-audit-remediation.md)。工作树 `/Users/chengjianghao/.codex/worktrees/ui-audit-remediation/flowcube`，分支 `codex/ui-audit-remediation-20261027`。开始基线为 `137e2e44d6d696d3929ea61c75992549a09a4fe3`，2026-10-27 已执行 `git fetch origin main` 并确认一致。原主工作区和其他任务工作树保持原状。

## 当前进度

| 任务 | 状态 | 结果 / 剩余事项 |
|---|---|---|
| T01 库存追溯 | 已实现并完成本地核验 | 需求、质量复审通过；页面回归 19/19；当前浏览器合成流水正负方向已核 |
| T02 口语分流与边界 | 已实现并通过两轮审查 | 最终后端定向 110/110、前端 18/18；浏览器已核口语预览、多意图与删单边界 |
| T03 修订与放弃预览 | 已实现，整批复审通过 | v2独立attempt与请求发起证据；共用专项131/131、实际丢请求→reload冻结→继续原版恢复；v1保留兼容 |
| T04 金额与单号 | 已实现，规格与质量复审通过 | 原文客户/金额/单号分开核；旧预览两段重核、保存选择传递；完整agent393/393 |
| T05 弹窗字段与滚动 | 已实现，规格与质量复审通过 | 5份窄回归42/42；占库/盘点合成GUI三尺寸与等效125%视口、末项焦点和列宽重开已核；账户流水吸顶Minor已随T06收尾，GUI另核 |
| T06 查询外壳 | 已实现，规格与质量复审通过 | 财务三页复用QueryDialog，流水/报销重置回当天；退货同壳分组；独立12/12；三页草稿/取消/重置及100行流水吸顶合成GUI已核 |
| T07 保存可达与返回 | 已实现，规格与质量复审通过 | 7文件148/148，独立19/19；GUI设置/权限滚底保存可达，双退货返回保原query，脏稿继续编辑/离开已核 |
| T08 空态与范围 | 已实现，规格与质量复审通过 | 13文件113/113，补未知汇总后对账9/9独立通过；宽表、capacity、恢复页及对账三态合成GUI已核，报告/审批主要为组件证据 |
| T09 时间范围与说明 | 已实现，规格与质量复审通过 | 8文件60/60；测试固定Date后新增6/6；实际合成GUI核日期chip、期末说明、4位原值、成本例外与库龄0/缺值 |
| T10 工具栏与切换器 | 已实现，规格与质量复审通过 | 5文件44/44，独立5/5；GUI两刷新入口唯一、读取原applied且保草稿，查询才应用新日期 |
| T12 小满时间与说明 | 已实现，规格与质量复审通过 | Agent定向38/前端39；采购批次数和缺值门补正后presentation独立9/9；当前runtime合成GUI15读取0业务写 |
| T13 小满历史与恢复 | 已实现，整批复审通过 | 原revision与跨版纯GET保留；危险5态回查不依赖编辑storage，真实Agent29/29；整批审全部Important关闭 |
| T14 | 已实现，规格与质量复审通过 | 原107/107，8态前后GUI/真实focus；长卡791→1011、普通791，窄视口末按钮可达 |
| T11 | 选择性两项已实现，双审通过 | UI094说明right→left/金额保留，UI112本页线图标；前后GUI已核，其余候选保留 |
| T15 | 产品待决 | 不直接采用阈值、能力扩展或 G-chat 去留 |
| T16 | 四项已实现，双审通过 | editor三红→26绿/Toast原1绿；A4时序、opaque错误提示、类型回退/内距、排名口径GUI已核；UI025/A5不改，真实库/设备未验 |

## 本轮实际验证

- Node `v22.23.2`；新工作树前端、后端分别按 lockfile 执行 `npm ci --no-audit --no-fund`，没有复制真实 `.env`。
- 修改前 `npm --prefix agent test`：210/210，通过。日志在 `output/ui-audit-remediation-20261027/agent-baseline.log`。
- T01 新增真实页面与 API 客户端回归：先 4 失败 / 15 通过，修改后 19/19。红绿日志已复制到同一输出目录。
- T01 浏览器：当前工作树 Vite 5207，任务专用合成 API 5208；输入 `AUDIT-I000001` 并点击查询，5 条记录分别显示 `+80 / -80 / -1.25 / +2 / -3`，真实业务补充备注仍可见。截图 `output/ui-audit-remediation-20261027/t01-trace.png`，正文 `t01-trace-dom.txt`。
- 合成 API 的小满运行时使用内存任务和合成 Flow 客户端；原本地演示服务失效后，其余页面改为当前 DTO 的明确合成 GET 白名单；缺失读取明确报错，拒绝转发业务写入。此证据不是数据库或生产验收。
- 浏览器使用 `flowcube-ui-fix-20261027`，本次 T01 检查结束已关闭，第二次 session list 确认空列表。后续检查复用该名称，结束再次核验。

## 最终本地验证矩阵（2026-10-28）

已核实可直接实施的修复已完成，逐任务规格/质量和最终整批 fresh 审查通过；最终审查 Critical / Important / Minor 均为0。代码和文档仍未提交、未推送、未部署。**完整验收矩阵仍有未验范围，不是发版就绪声明。**

| 检查 | 实际结果 | 运行阶段 / 证据 |
|---|---|---|
| 前端完整单测 | 431文件，4002/4002，exit0 | 首轮集中检查，在最后冻结模块补正前；2 workers；`final-frontend-full.log` |
| Agent完整单测 | 首轮407/407；最终412/412，均exit0 | 最终新增恢复合同后独立补跑；`final-agent-current.log`，保留407历史 |
| 最终前端受影响回归 | 5文件156/156，exit0 | 冻结/工作区131 + cleanup相关25；`post-fix-frontend-affected.log` |
| 最终Agent恢复合同 | 29/29，exit0 | 原键5态恢复零业务写与既有合同；实施者与final reviewer独立验证 |
| 最终前端lint / 类型 / build | 全部exit0 | 指定`tsconfig.app.json`；`post-fix-frontend-{lint,type,build}.log` |
| backend lint | exit0 | 首轮集中；最后补正未改backend产品代码 |
| 前端约定 / 日期 / 轮询合同 | 全部exit0 | 首轮集中；最后补正未改变对应路由、日期或轮询协议 |
| API路由 / 写路由权限 / 权限 / 文档守卫 | 全部exit0 | 首轮集中；文档收尾再核守卫与diff |
| style-compat | exit0；基线守卫3/3；桌面2070与PDA边界2070比较均0差异 | 最后补正后，保原golden；dark/guest-PDA作用域、touch模拟和弹窗检查通过 |
| 最终关键GUI | 通过，业务写0 | v2标记丢修改请求后reload仍冻结，明确继续原版新revision恢复；截图/JSON已核 |
| 资源 | 会话列表空，5207/5208无监听 | 只停止核对cmd/cwd后归属本任务的服务，`resources-final.json` |

所有本地日志与截图在`output/ui-audit-remediation-20261027/`，不随Git自动提交。首轮`final-checks.json`保留lint/type原失败（3路径机械问题），不覆盖伪装全绿；随后3行cleanup和最终模块修复后已独立补绿。**没有在最后补正后重跑完整4002，不能将它冒充最终快照的完整重跑；最终快照由受影响156、静态/构建、样式兼容和独立审查补证。**

未执行的验收范围：

- T05审批1/5/10级及用户1/12/30角色的完整键盘/大数据GUI矩阵；原结构经源码复核保留，未逐组合操作。
- 真正浏览器125%缩放；已做1093×614等效可用CSS视口，不能外推成实际Chrome缩放。
- T06全部日期浮层、上下拉、切标签与后台刷新组合；T07逐角色、双击及未知结果GUI全矩阵；T08截断列表/图表/审批各态的全部真实后台组合。已跑样板GUI和组件/合同证据分别记录，未勾项保留。
- 全81页重验、真实数据库/完整财务与库存流程、真实模型、远端CI、生产、Windows安装更新、PDA真机、打印设备与出纸。
- T15仍产品待决；T11其余候选/未复现项保留，不宣称原128项全部成立或全部修改。

## 新补证据

- UI-113：已有 A4 模板首载时画布 1050px，容器 942px、scrollWidth 1082px；点击已有“适应”后画布 892.5px（85%），scrollWidth 回到 942px。源码 fit effect 仅依赖 paper.w，加载分支没有画布 ref，而同宽模板加载结束未再次触发。证据在 `t16-print-fit-evidence.txt` 与两张截图；先前无 success 的合成响应出错已排除为夹具错误。没有保存模板或打印。浏览器再次关闭并确认会话空列表。

- T02 浏览器：原生前端 + 当前内存运行时，完整“开个单”生成数量 2 / 合计 25 元的待确认卡；多意图只查库存并明确后续未处理；“还欠我们多少钱”显示原合成台账 25 元；“删掉这张草稿”明确不能代办并显示销售页入口。证据 `t02-*.png` 与 `t02-browser-evidence.json`，业务写调用 0。模型、真实库未验。浏览器已关闭并确认退出。
- UI-115 新补证据：错误提示在当前正式桌面壳可见顶栏文字透出；源码桌面样式将 bg-red-50 改为透明度 0.06。实际顶层命中 toast，本次正常自动消失，故拟仅修提示背景不透明，未证明需要改层级或计时。

- T02 独立复审发现并已修正两项：纯数量明细被拆成商品/数量，以及状态词掩盖删除等明确动作。补纯数量零模型/零工具与 13 类图外动作混合改量保持原预览/版本/键的负例；新增守卫一度误伤后置流程提问，最小修正后两类均保留。最新定向 107/107，最终复审与质量审查继续中。

- T02 最终：质量复审发现的多行首/中行缺数量已修正；逐行缺槽在模型与搜索前澄清。实施者最终定向 110/110，质量 reviewer 独立缺槽/边界 25/25，原反例模型0/读取0/写入0/任务0。需求与质量审查均通过，未改 T03 函数。

- T07 新核：商品新建页在 1440×900 滚到底（439px）后原 ActionBar 为 sticky，保存按钮仍在 y=94–130 的可视区，截图已看。此分支不新增第二套操作区；权限与设置单独处理。见 `t07-product-sticky-evidence.txt`。

- T07 设置页补证：点击编辑后滚到底，原保存按钮 y=-44～-8，已离开可视区。只进入编辑态，没有改值或保存；此页保存可达问题成立，与商品页结论不同。

- T16 打印机合成补证：API type=99/typeName=其他时，当前类型单元格为空；中文名称正常，未复现乱码。设备别名原生 input 左右 padding 为0，确认贴边；不据此声称发生编码或左侧裁切。保留行内编辑，后续仅补类型回退和输入外观。

- T03 浏览器：2→3 生成 revision 2；1.001 非法数量保留 3 并禁用确认；继续原版重新试算为 revision 3；文字确认只指引按钮；放弃后保留 CANCELLED 记录。合成运行时 19 次读取、0 次业务写入；截图/文本 `t03-*`，浏览器关闭后会话列表确认空。此为当前代码配合合成服务，非真实数据库流程。

- T03 规格复审：规范中文整数与行号反向校验后，`一二/十十/零三` 等歧义串不再修改旧量，25项中文专项独立通过。质量审查另发现网络失败后刷新可能丢失仅存内存的冻结，当前补按用户/服务器归属的持久恢复；该项关闭前不标完成。

- T16 补证：收货异常按钮已有具体原因 aria-label/title，可键盘聚焦；待我审批列表已实查加载→失败、空列表及合成有数据四态，没有复现永久灰块。采购两张排名来自同API却分别包含“非取消订单”和“已完成订单”，源码范围确实不同，拟说明现有口径，不改统计规则；实际库未对账。见 `t16-extra-evidence.txt` 和对应截图。

## 2026-10-28 续接

- 本地临时演示目录/服务已不存在，本次重启任务5207/5208，用新建合成身份与内存任务验证小满；其他缺失GET明确报错，没有接真实库。浏览器实证：改量POST中止，刷新后同版旧确认仍禁用；继续原版重新读取并生成新版后恢复确认。证据 `t03-reload-freeze-20261028.*`；合成业务写入 0。本任务浏览器已关闭并确认列表空。
- 当前前端组件37/37、完整agent328/328、前端lint与tsconfig.app.json类型检查均退出0；未跑构建/全量前端/真实数据库。完整agent旧拒绝文案测试已同步为当前语义与安全页面枚举，并补t.after保证断言失败也关服务器。

- T03 最终质量复审：跨实例新尝试取较高版本、低版本阻断/终态不清新冻结、清理前复核attempt身份，两个Important已关闭；独立模块8/8通过。原先‘本次未发送’通用存储错误已改为准确的冻结记录错误，README/前端规范同步。

- T04实施者定向172/172，通过，独立规格审查中。当前代码GUI：含SL20261026009和25元的原句明确识别并停步，无预览，Flow读取0/写入0；普通无指定目标“付了25元核销”准确生成原客户25元第一段登记卡，读取5/写入0。截图与文本 `t04-*`。未点击确认，非真实账务验收；浏览器关闭并确认空列表。

- T04原名补正规格复核通过：张钱/给力五金保留完整原文；只缩名存在时停步；命令双解读命中不同ID时澄清。独立六文件183/183，质量审查中。T05后续UI批次已启动，T15仍待产品决策。

- T05：局部紧凑五身份列通过 ReportTable 透传密度；五列名、索引与原持久键均保留。盘点固定标题/页脚、单正文纵滚，资金账户编辑与流水复用现有表单壳；报废创建、用户、审批流、日志已有相应结构，复核后未改。fresh规格通过、质量批准，独立五份窄回归42/42。质量Minor为账户流水表头吸顶归属，随T06同文件最小收尾。
- T05合成GUI：当前5207/5208白名单GET夹具，30行长名称盘点末行可聚焦、未填值保持空，标题与保存可达；占库三个桌面尺寸首屏仓库与核心数量完整。真实键盘调整名称列后关闭重开，原持久键下精确宽度135.698px保持。另用1093×614模拟1366×768在125%下的CSS可用视口，核心输入仍可达；**没有操作浏览器Chrome缩放控制，不能称为实际125%缩放验收**。证据`t05-*-matrix.json`、`t05-*-stable-*.png`和`t05-gui-evidence.txt`，早期动画帧不作稳态证据。未提交任何业务、未连DB；浏览器关闭并二次list为空。

- T04最终质量通过，全部Important关闭：正常两候选选择→登记→核销DONE，各仅一次；撤客户候选则零核销，原款保留勿重登。root完整agent393/393退出0（`ui-t04-final-agent.log`）；相关六文件201/201。第一批T01–T04代码完成，数据库、生产与CI未验；后续UI批次继续。

- T01返回补验：实际从`库存管理?keyword=AUDIT-KEEP`经“库存”菜单进入“批次追溯”，输入合成条码并点击查询，随后点击原“库存管理”标签；回到原列表，URL应用条件`keyword=AUDIT-KEEP`保持。追溯页本身没有另设返回按钮，使用现有菜单/工作区标签导航。证据`t01-return-inventory-20261028.txt/png`，无业务写；会话关闭后第二次list为空。T01最后验收勾选已据当前证据完成。

- T06：财务账户/流水/报销查询复用QueryDialog，保留520/680/680按内容宽度，默认520未改；两类退货统一680并分订单/日期经办/备注组，原type/initial/resetValues与请求参数保持。带日期“重置”明确回各自默认当天起止，页面chips显式清空仍沿不限日期合同。T05账户流水正文同一overflow-auto、移除内部横滚对sticky归属的拦截。fresh规格与质量均通过，独立12/12；实施回归4文件28条、另new6+退货草稿20条共26条通过，包含真实初始焦点及空日期重置红例。其余已共用查询壳/单层footer的入口复核后保留，未批量重做。

- T06合成GUI：三个查询实际宽520/680/680，初焦关键字；输入未应用条件后取消、等退出动画完成再重开，仍为原已应用值；重置后账户空，流水/报销均2026-10-28当天起止。账户100行流水滚底（6348/7012，正文高664），表头仍在正文内、标题与关闭页脚固定，T05吸顶Minor据此关闭。证据`t06-query-gui.json`、`t06-account-sticky-gui.json`及`t06-*.png`。组合页H1统一为“资金工作区”，早期等待旧标题/懒加载帧的失败是自动化定位错误，最终显式reload当前路由并等待实际控件后取证。无业务写，浏览器关闭后二次list为空；实际Chrome缩放及所有日期浮层边界仍未做。

- T07：设置/权限页唯一页头改用ActionBar复用原按钮、状态、说明和handler；商品新建已有sticky、科目已有键盘发现性，未重复改。销售添加区按真实仓库/商品查看权限提示，ordinaryOnlySave和保存逻辑不变；分类补焦点/触摸发现性。双退货新建/无效/不存在详情及报废、退款无效来源用权限化返回出口，沿getWorkspaceListPath与脏稿确认。新helper异步确认复核session/user/server/activeKey/原tab对象/mounted/最新disabled，失格不关新草稿、不遗留bypass；只读处理来源GET允许返回并abort，手工载入原单/业务提交忙时禁用，不清原恢复记录。fresh规格最终通过、质量通过；7文件148/148，独立19/19，含11初始行为红与5确认归属/bypass红。
- T07合成GUI：设置25字段和完整权限组滚底，两个保存按钮均在y94–130，修前分别负千位不可见，未改值/权限或保存。双退货实际从带`keyword=AUDIT-KEEP&range=all`列表点击新建、返回，原URL完整保留；销售退货输入合成未保存备注→返回触发真实离开确认→继续编辑保留原备注，再返回并确定离开回原query列表。证据`t07-after-20261028.json`、`t07-return-gui.json`、`t07-dirty-return.txt/png`。无业务写，会话关闭后二次list为空；触摸设备与实际Chrome缩放仍未验。

- T08：DataTable仅成功空行按视口居中；三恢复空页统一，保原记录/错误/epoch/backfill与原键；对账区分未查询/读取暂停/失败/空，缓存未知不供选择生成；容量null/undefined为—，0保持；供应商退款仅解释既有权限仓范围；报表/审批空态与失败独立，审批写入口按原manage权限。初版13文件113/113；root复审发现已勾选后刷新失败/暂停的汇总仍投成0，已修为待核对/合计—、footer禁用且不显示假笔数金额，原picked保留并恢复。新增三种¥50→fetch/error/paused→恢复的负例，先红5后9/9；fresh规格补正与质量独立复核9/9均通过，不把初版113的运行次数冒充修后整套重跑。
- T08合成GUI：2290px宽表保原表宽，1390可视区文字中心1170→720，横滚两端与缩窄保持可视居中；有行后containerType为normal。库位两行分别null→—、0→0。三恢复空页明确当前账号服务器无待核请求，无自动办理；对账实际打开未填对象/成功空/HTTP500分别指引/空/失败，未点生成。证据`t08-gui-evidence.txt`、`t08-*.json/png`；已选择后失败/暂停的保留与恢复由组件负例证明，未另作GUI。报告/审批其余状态以组件证据为主，真实API/设备未验，会话关闭后二次list为空。

- T09：七产品文件仅呈现范围/来源，T01trace不重复改；开放日期明确起始不限/截至不限，调拨自定义chip以实际生效值显示、默认七天隐藏、移除回原默认、range=all与清空协议保留。ABC按真实授权启用且有ACTIVE容器的仓库，再统计该仓ABC记录说明，不误称逐商品都在库。会计期末改说明；snapshot正常来源集中，其他混合/估算/缺失/未知仍逐行，四位原值/两位投影不舍入；库龄零与缺值分开。8文件60/60，fresh双审通过；测试跨午夜Minor仅Date固定后6/6补绿、finally恢复时钟，产品未再改。
- T09合成GUI：实际移除调拨自定义日期chip，URL回默认兜底；资产负债表期末为文本说明且无同名按钮。凭证核对0.0049原值/差额与0.00投影分别完整显示；毛利表mixed保1行缺失与¥20估算、unknown保待核实，snapshot仅合计值配表前说明；库龄0/null/1/0显示0/—/1/0。证据`t09-gui-evidence.json/txt`与`t09-*.png`，均合成数据不作真实账务/库存对账证明，无业务写，浏览器关闭后二次list为空。

- T10：批次效率/PDA去页头同作用域重复刷新，保日期条原入口与applied；岗位待办+通知与履约独立刷新精确命名不合并。仓库运营去裸path重复入口，真实组件MergedPage（三路由映射、同权限视图、PageHeaderContext导航、viewPaths）保导航与查询记忆。账号次左主右、采购草稿提交主色、分拣格危险描边、ABC规则操作组上移、统计/报税类别复用原分段，仅呈现、handler/权限/确认不变；采购建议两子路由与合理不同样板保留。按root建议仅删毛利两caption重复正常成本句，保范围/异常/卡行警告。5文件44/44，fresh双审通过，独立operations-empty5/5。
- T10合成GUI：实际日期输入2026-01-02后点击唯一“立即刷新”，PerformanceResourceTiming所见GET仍原applied的2026-10-22..28，输入草稿保留；点击“查询”才发送新起日。wave/PDA两页均成立，证据`t10-refresh-gui.json`与对应截图，未调用业务写。浏览器关闭后二次list为空。其它按钮/分段主要为diff与独立审查，真实后端、设备未验。

- T12：库存/简报显式北京时间；台账说明本次查询完成时点，不冒充事务快照。真实priceLevelName沿API传卡，A/B旧快照、自定义表名及未知来源明确回退；初始正文精简后卡补采购分组小计/本批N张、占库单号/可用量/待占合计，收款未结范围、账户选择、两阶段、风险/修订/未知回执/第二意图保留，不改T02–04控制链。初版Agent定向38/前端39通过；规格发现采购N张遗漏已补三状态卡事实。root抽查time(null)假1970与money(null/空串)假0，已仅加缺值前置门，原ISO、数字0/字符串0和精度保留；2新增briefing消费者负例红绿，fresh规格与质量补正独立presentation9/9通过。
- T12合成GUI：重启5208加载当前agent源码后，实际发送库存查询、往来查询，统计/查询时间显示北京时间；销售开单初始正文只结果与下一步，卡保客户/仓库/2个/单价12.5/完整“客户等级价：价格A”/合计25，未点确认。15次合成读取、0次业务写，证据`t12-runtime-evidence.json`、`t12-gui-evidence.txt`与截图；自定义名、多组采购、双TZ及缺值为组件/Node证据，非真实账务验收。会话关闭后二次list为空。

- T13：最近记录类型/对象/阶段与明确stage2TaskId分组，普通待办手动恢复，危险/本地未知/冻结独立最小元数据集合；recent上限30、缺席仅GET原ID、临时失败保已知、拒绝清敏感且提示核原业务勿重复。规格组合补正后又用真实SectionVisibilityContext四红关闭新选中卡迟到覆盖。fresh质量额外3实证已关闭：低revision终态不能回退当前卡/独立集合；非终态文字确认/回读不清unknown；原确认revision独立保存，跨版/缺失查询只GET。新增七红后前端107/107、受影响Agent93/93；原质量三probe及真实TTL合同1/1独立通过。
- T13关键GUI：实际5207/5208内存runtime创建2个合成销售预览rev1；拦截原确认请求使其未到服务，第一浏览器标签保本地unknown；同一命名会话第二浏览器标签手动恢复原任务并输入改成9个，真实T03生成同ID rev2。回原标签刷新后点击查询原结果，API记录仅1次GET原任务，无confirm POST、无FlowClient业务写；卡保9个/112.50与原未知提示，明确不能把查询作为新版确认。证据`t13-revision-gui-evidence.json`、`t13-original-confirm-revision-get-only.png`；其余历史GUI见`t13-gui-evidence.txt/json`，不冒充真实DB。会话finally关闭后二次list为空。

- T14：仅小满两组件、局部CSS与说明；Button复用确认/发送/原结果查询，SoftStatusLabel沿原文字与状态语义。去重复姓名/角色只保仓操作范围，非空采购分组/核销分配才1120上限，普通900、正文72ch、欢迎660/输入原宽保留。fresh规格与质量均通过，质量逐一比对17事件/15禁用表达式相同，原107/107；未改hook/types或安全协议。8态前后GUI与真实键盘focus已核，长卡791→1011、普通791；等效125%视口两长卡702=scrollWidth且末按钮可达，确认/发送同共享主色/10px单焦点。证据`t14-gui-evidence.txt`、矩阵/焦点JSON与截图；未办理业务，浏览器关闭后二次list为空。

- T11：只实施UI094成本说明浮层text-left与UI112本页finance/system线性装饰图标；原金额右对齐/精度/诊断/按钮可达及提醒文字/优先级/权限/排序/路径/刷新不改。fresh双审均0问题；实际前后截图已看，Popover键盘打开计算right→left，P2/P3原文保持，见`t11-gui-evidence.txt`。纯呈现不新增镜像测试，其余候选不按宽表/形态差异强改。浏览器关闭后二次list为空。

- T16：四已证项仅7文件。首载canvasReady与原loading条件等价，原fit/observer在同A4加载后附着，3几何模拟红→编辑器26绿、Toast原PDA1绿；fresh规格/质量均0问题。错误Toast仅原浅色desktop且排除dark/PDA/guestPDA的scope内opaque背景，计时/层级不动；打印机known→API名→未知，别名仅px2；采购两榜金额Top20与单处真实范围，无SQL/计算/日期参数变化。两主题文档同批同步。
- T16合成GUI：A4首载85%/892.5px，父942=scrollWidth；手动95%缩窗保留，点击适应78%无横滚；隐藏切标签后1920再激活100%。打印机type99/API其他与type98/空名分别其他/未知类型，中文原样，别名左右8px。采购supplier20行，商品榜数量2/金额1000排数量100/金额500之前，说明现有金额排序，GET仍当日起止。错误提示最终稳态opacity1/背景alpha255、宽320、z9999、顶层命中；hover约4秒内消失，重复相同读取错误保持1条，切页仍显示并自动关闭。首次.92983入场帧已剔除，未据此改计时。证据`t16-gui-evidence.json`与`t16-*-after.png`/repeat-navigation。未保存模板/别名、未绑定或打印，真实库未对账；浏览器finally关闭后二次list为空。

- 集中验证首轮：Node22.23.2，前端完整431文件4002/4002，Agent407/407，frontend build、backend lint与计划各合同均退出0；frontend lint/type发现3路径机械缺口（死导入、测试非法exact、两个fixture缺closable），单一cleanup3行补正后相关25/25、lint/type均退出0。首轮矩阵保留原失败，不覆盖为假全绿。

- 最终整批审闭环：单一修复者将冻结改为每attempt独立v2键、请求发起时不可变观察证据；晚到响应不清晚生尝试，普通GET新版只展示保冻，文字确认回显不取得advance证据。v1原字节不删不覆，仅按准确旧身份另存解除证明。5种server危险态的原key回查不依赖编辑storage，AWAITING原确认revision/缺失跨版纯GET和写确认冻结门保留。12红后前端131/131、真实Agent29/29；final reviewer独立重放late-A/remove/begin/v1/文字确认/5危险storage边界并亲跑同套，最终0问题。
- 最终GUI按新模块重取：实际修改POST丢失，v2 marker1→reload仍1且确认禁用→明确继续原版同ID rev2后marker0、确认恢复，业务写0，见`final-freeze-gui-evidence.json/txt`和两关键截图。最终lint/type/build与相关5文件156/156退出0；style-compat退出0，原golden未变。最终Agent又独立补完整412/412，保留首轮407。所有命名浏览器退出，5207/5208按归属停止；剩余仅上列未执行验收/待决，不留未关闭代码Important。

## 2026-10-28 代码交接（极序验收 + 极序测试代 Muse 验证）

本节按2026-10-28最新授权继续：GPT负责代码、提交推审和跟进自动检查；极序验收负责代码验收，极序测试负责功能/页面验证，由无敌霸王龙协调测试群，二者代替Muse执行独立验证。下文保留原Muse清单的具体内容，执行方改为上述极序bots。前文的“通过”“0问题”、截图与数字均为GPT历史自查/自测记录，**不代表极序验收或极序测试的独立验证结果**。本节不开展浏览器、角色、缩放、真实库、云CI、真机或出纸验收；这五类结果全部留给Muse填写。T15（U9/U13/U14、R9/R13/R15）保持产品待决，不新增模糊匹配、金额/数量阈值、商务卡点范围或G-chat去留逻辑。

### 1. 代码身份与收尾范围

- 工作树：`/Users/chengjianghao/.codex/worktrees/ui-audit-remediation/flowcube`。
- 分支：`codex/ui-audit-remediation-20261027`；本批起始基线：`137e2e44d6d696d3929ea61c75992549a09a4fe3`。本轮获准将全部修复提交并推到该分支，对main开草稿PR；后续以PR最新Head SHA标识修复代码，不能只取起始基线。
- 本批提交前相对起始基线共101个文件：82个已有文件修改、19个新增文件，全部纳入推审提交。逐文件见下表；`output/`忽略产物另列，不算业务源码。
- 上一轮仅准备本交接和源码快照。本轮按用户授权整理提交、推分支并开PR，跟进该PR自动检查；不新增无依据的产品逻辑，不改角色权限、已有迁移、版本号、设备逻辑或发布流程，不合并、不打tag、不发版，不向其他会话或群发送内容。
- 代码闭环：T01流水呈现已在页面消费；T02分流→runtime白名单→前端权限化链接完整；T03任务状态/锁→后端cancel→hook→预览按钮及持久冻结完整；T04原文校验→候选→两段预览/恢复完整；T05–T10已选页面消费共享壳/返回/空态/说明；T12–T14沿实际runtime和工作区消费；T11仅两处选择性精修；T16仅四项已确认可修部分。这里说明代码接线，不作为独立验证结论。
- 未改的待复现/候选保留原结构，尤其用户/审批流长弹窗、UI025、A5及T11其余候选；不能把这些写成“已整改全部原报告问题”。

### 2. 逐文件改动清单

下表覆盖101个文件；T编号对应本目录修复计划，UI/U/A/V/R编号对应原核查台账。测试文件属于GPT开发自测材料，Muse应独立选择样本与故障时序。

| 文件（相对本工作树） | 改动内容 | 审计对应 |
|---|---|---|
| `agent/README.md` | 同步口语入口、原文金额、预览冻结/放弃、两阶段及恢复边界 | T02–04、T12–14；U1–8/U10–12、V1–9 |
| `agent/src/agent.js` | 接入口语图、改量/继续原版/取消互斥、原文客户金额复核、两段选择继承、时区/来源/精简正文与只读未命中 | T02–04、T12–13；U1–8/U10–12 |
| `agent/src/llm.js` | 意图校验保留单号和日期，模型不得覆盖原文金额/客户/目标 | T04；U3、R3 |
| `agent/src/receipt-amount.js` | 分别解析分位金额/目标单号/日期，保留完整客户原名，拒绝不支持目标 | T04；U3、R3 |
| `agent/src/reports.js` | 显式北京时间，缺时间/金额不伪装1970/0，解释提醒与补货两种口径 | T12；A1、U8/U10、R8/R10 |
| `agent/src/routing.js` | 开个单/下单/欠款口语、逐行缺槽、整句图外动作、首意图告知及业务页枚举 | T02；U1/U5/U6、R1/R5/R6 |
| `agent/src/runtime.js` | 透传暂停/未命中元数据、过滤业务页枚举，接同任务cancel端点 | T02–03/T13；U4/U6/U11 |
| `agent/src/task-access.js` | 安全视图携带confirmationBlocked，只为两类只读未命中提供queryOutcome | T03/T13；U2/U11 |
| `agent/src/tasks.js` | 持久保存确认暂停原因，新试算重置原因，注明取消共用任务锁 | T03；U2/U4 |
| `agent/test/agent.test.js` | 同步图外动作拒绝与安全业务页断言，失败也关闭本例HTTP服务 | T02；U6 |
| `agent/test/colloquial-routing.test.js` | 新增口语路由、多意图告知、缺槽/数量伪商品和越界零调用负例 | T02；U1/U5/U6 |
| `agent/test/conversation-recovery.test.js` | 增加取消/冻结/只读未命中、TTL与旧revision、五种执行态原键恢复合同 | T03/T13；U2/U4/U11/U12 |
| `agent/test/embedded-api.test.js` | 覆盖嵌入式cancel路由、鉴权/权限/正文预算与原任务访问 | T03；U4 |
| `agent/test/llm.test.js` | 覆盖单号/日期透传与不合法意图拒绝 | T04；U3 |
| `agent/test/presentation.test.js` | 新增双时区、缺值、真实价目名与口径说明回归 | T12；A1/A2、U7/U8/U10 |
| `agent/test/preview-controls.test.js` | 新增规范中文改量、暂停/重算/取消/竞态及不越过确认负例 | T03；U2/U4 |
| `agent/test/quality-boundaries.test.js` | 覆盖不完整口语、图外动作混合改量、客户原名及收款身份边界 | T02–04；U1–6 |
| `agent/test/receipt-input.test.js` | 新增单号与金额共存、日期、非法金额、完整客户名与歧义原文负例 | T04；U3 |
| `agent/test/receipt.test.js` | 覆盖原文身份/金额、旧预览两段重核、选择继承与撤权停止 | T04；U3 |
| `backend/src/modules/assistant/assistant.controller.js` | 转发原任务cancel到既有嵌入式服务 | T03；U4 |
| `backend/src/modules/assistant/assistant.routes.js` | cancel写入口复用既有认证、入口权限和正文限制 | T03；U4 |
| `docs/backend-api-sql-conventions.md` | 同步cancel接口授权/任务互斥与持久暂停约定 | T03；U2/U4 |
| `docs/finance-permission-time.md` | 同步原文金额/客户/目标、两阶段登记事实与恢复边界 | T04；U3 |
| `docs/frontend-pda-conventions.md` | 同步本批UI样板、小满冻结/恢复/历史/令牌规范 | T01–14/T16（T15不含） |
| `docs/print-deploy-ops.md` | 同步首载fit/打印机回退/错误提示边界及独立出纸要求 | T16；UI-113–117 |
| `docs/superpowers/plans/2026-10-27-ui-audit-progress.md` | 保留GPT历史自测，续写本次逐文件清单、五项待Muse入口与交接边界 | T01–16执行交接；T15仅列待决 |
| `docs/superpowers/plans/2026-10-27-ui-audit-remediation.md` | 保留核查后分批实施范围与尚未执行的验收勾选项 | T01–16计划；T15仅列待决 |
| `docs/superpowers/plans/2026-10-27-ui-audit-verification-ledger.md` | 保留原报告各条核查分类/候选/不采纳及后续实现索引 | UI-001–128/A/U/V/R核查台账 |
| `frontend/src/components/agent/AgentWorkspace.test.tsx` | 覆盖业务页、预览字段、普通手动恢复/危险集合、切角色服务器、30上限、迟到响应/旧版终态/原确认版本、quota与文字确认负例 | T02–04/T12–14；U1–8/U10–12、V1–9 |
| `frontend/src/components/agent/AgentWorkspace.tsx` | 历史类型对象阶段/精确两段分组、危险恢复入口、业务页导航、放弃/只读核对及共享按钮/状态；保仓范围 | T02–03/T13–14；U4/U6/U11/U12、A3、V1–9 |
| `frontend/src/components/agent/BusinessPageLinks.tsx` | 新增代码内业务页白名单，沿当前权限/路由注册表打开业务页 | T02；U6、R6 |
| `frontend/src/components/agent/TaskPreview.tsx` | 补完整价来源/采购批数/占库字段，暂停与放弃，复用Button/SoftStatusLabel | T03/T12/T14；U2/U4/U7、A2、V2/V4/V7/V9 |
| `frontend/src/components/agent/previewFreeze.test.ts` | 新增持久/异常/归属/v1及跨实例begin/remove/late-A交错负例 | T03/T13；U2/U4/U12 |
| `frontend/src/components/agent/previewFreeze.ts` | 新增账号/服务器/任务隔离的v2逐attempt冻结、发起观察集合、v1准确身份兼容及失败关闭 | T03/T13；U2/U4/U12 |
| `frontend/src/components/agent/types.ts` | 补确认阻断/查询未命中/业务页/价格来源类型，历史标题/状态/显式两段分组帮助函数 | T02–03/T12–13；U6/U7/U11/U12 |
| `frontend/src/components/agent/useAssistantConversation.ts` | 发送/取消前持久冻结，观察证据绑定、低版回读保护、独立危险集合、原确认revision与跨版纯GET，服务端危险态恢复独立于编辑存储 | T03/T13；U2/U4/U11/U12 |
| `frontend/src/components/agent/xiaoman.css` | 仅小满颜色/状态/边框使用令牌，长采购/分配卡1120而普通900/正文72ch，保原响应布局 | T14；A3、V1–9 |
| `frontend/src/components/shared/DataTable.tsx` | 成功空行按可视滚动区居中，保原表头/列宽/数据分支 | T08；UI-099及宽表空态共用样板 |
| `frontend/src/components/shared/FulfillmentTodos.tsx` | 履约卡刷新明确为刷新履约事项，保原范围与handler | T10；UI-111 |
| `frontend/src/components/shared/PaymentQueryDialog.tsx` | 开放起止/到期日期chip用起始不限/截至不限，保原查询值 | T09；UI-048/049/050/051 |
| `frontend/src/components/shared/ProductIdentityCells.tsx` | 五身份列可选择compact密度，默认宽度与字段顺序保留 | T05；UI-001/033 |
| `frontend/src/components/shared/ReportTable.test.tsx` | 补compact身份表头透传/原持久键回归 | T05；UI-001/033 |
| `frontend/src/components/shared/ReportTable.tsx` | 展开商品身份表头时透传密度，保索引与原持久列宽键 | T05；UI-001/033 |
| `frontend/src/components/shared/WorkspaceListReturnButton.tsx` | 新增保原查询/脏稿的返回，异步确认复核账号/服务器/同键草稿/忙态/权限 | T07；UI-028/040/061 |
| `frontend/src/components/shared/payments/CreateStatementDialog.test.tsx` | 补选择后刷新失败/暂停/恢复等负例，真0与未知分开 | T08；UI-052 |
| `frontend/src/components/shared/payments/CreateStatementDialog.tsx` | 未查/失败/暂停/真实空分开；读取不可信时保已选集合但汇总待核/不供生成 | T08；UI-052 |
| `frontend/src/components/shared/productIdentityHeaderCells.tsx` | 提供opt-in compact表头宽度及类型，保原默认宽度 | T05；UI-001/033 |
| `frontend/src/pages/accounting/reports/index.tsx` | 期末含义改为说明文本，保实际期间计算 | T09；UI-073 |
| `frontend/src/pages/accounting/tax/index.tsx` | 增值税/所得税切换复用现有分段样式与aria状态 | T10；UI-085 |
| `frontend/src/pages/accounting/vouchers/index.tsx` | 供应商退款勾稽拆成有标签字段，保四位原值/两位投影及差额 | T09；UI-069 |
| `frontend/src/pages/approvals/flows.select.test.tsx` | 补失败/空态与只读角色无写入口的组件合同 | T08；UI-121 |
| `frontend/src/pages/approvals/flows.tsx` | 加载/失败/空分开，只向原manage权限展示写操作/下一步 | T08；UI-121（UI-120原结构保留） |
| `frontend/src/pages/carrier-accounts/index.tsx` | 页头次动作在左/新增主动作在右，保禁用与导航 | T10；UI-016 |
| `frontend/src/pages/categories/index.tsx` | 分类编辑操作补focus/touch发现性，保原动作 | T07；UI-108 |
| `frontend/src/pages/disposal/DisposalRecoveryPage.tsx` | 空恢复页说明当前账号/服务器无待核请求，不清记录/重发 | T08；UI-041 |
| `frontend/src/pages/disposal/HandlingScrapPage.tsx` | 无效来源给页头和权限化返回报废列表，保原参数 | T07；UI-040 |
| `frontend/src/pages/disposal/handling.test.tsx` | 同步无效来源出口的组件期望 | T07；UI-040 |
| `frontend/src/pages/finance/accounts/index.tsx` | 查询复用QueryDialog，账户表单用共用壳，流水同滚动祖先吸顶/固定头尾 | T05–06；UI-055/056/057 |
| `frontend/src/pages/finance/expenses/index.tsx` | 查询复用QueryDialog，重置回本页默认当天，保草稿/取消 | T06；UI-059 |
| `frontend/src/pages/finance/transactions/index.tsx` | 查询复用QueryDialog，重置回默认当天；清理遗留未用DialogFooter导入 | T06；UI-058 |
| `frontend/src/pages/inventory/trace.test.tsx` | 新增真实追溯页面正负号、零值、未知类型与备注保留回归 | T01；UI-031/032 |
| `frontend/src/pages/inventory/trace.tsx` | 入库正abs/出库负abs/其他保原号；只去技术重复备注 | T01；UI-031/032 |
| `frontend/src/pages/locations/index.test.tsx` | 补容量缺值与0区分的页面合同 | T08；UI-045 |
| `frontend/src/pages/locations/index.tsx` | 容量缺值显示—，真实0保留0 | T08；UI-045 |
| `frontend/src/pages/permissions/index.test.tsx` | 新增唯一操作区/待处理禁用/只读合同；修正测试选项类型 | T07；UI-124 |
| `frontend/src/pages/permissions/index.tsx` | 单一ActionBar承接原编辑/保存/取消及禁用态，保存区sticky | T07；UI-124 |
| `frontend/src/pages/purchase/form/index.tsx` | 草稿详情提交改为主推进按钮，保原确认文案/handler/权限 | T10；UI-018 |
| `frontend/src/pages/reports/CurrentValuationCost.tsx` | 成本说明Popover显式text-left，金额仍右对齐 | T11；UI-094 |
| `frontend/src/pages/reports/index.tsx` | 统计类别分段；采购金额Top20标题与现有订单创建日期/仓范围/状态口径说明 | T10/T16；UI-089/090 |
| `frontend/src/pages/reports/inventory-aging.tsx` | 天数分布真实0保留、缺失用— | T09；UI-096 |
| `frontend/src/pages/reports/operations-empty.test.tsx` | 新增批次/PDA报表加载/失败/空/重试等组件合同 | T08/T10；UI-098–101 |
| `frontend/src/pages/reports/pda-anomaly.tsx` | 只保日期条同范围刷新，失败显式显示，图表空态说明统一 | T08/T10；UI-100/101 |
| `frontend/src/pages/reports/profit-analysis.tsx` | 正常快照成本来源集中、混合/缺失/未知逐行，保排序/精度/风险 | T09；UI-093 |
| `frontend/src/pages/reports/role-workbench.tsx` | 页头刷新明确岗位/提醒范围，提醒用现有线图标 | T10/T11；UI-111/112 |
| `frontend/src/pages/reports/warehouse-ops.tsx` | 移除与组合页导航重复的裸路径快捷入口，保既有组合路由 | T10；UI-097 |
| `frontend/src/pages/reports/wave-performance.tsx` | 去同范围重复刷新；加载/失败/成功空表分开，保日期草稿/applied | T08/T10；UI-098/099 |
| `frontend/src/pages/returns/ReturnQueryDialog.tsx` | 两类退货查询同680壳并按条件分组，保各自初值/重置/请求 | T06；UI-005/027 |
| `frontend/src/pages/returns/ReturnUnavailable.tsx` | 新增退货无效/不存在状态的权限化返回壳 | T07；UI-028 |
| `frontend/src/pages/returns/purchase/form/index.tsx` | 新建/无效/不存在增加共用返回，保筛选/脏稿和提交忙态 | T07；UI-028 |
| `frontend/src/pages/returns/sale/form/index.tsx` | 新建/无效/不存在增加共用返回，保筛选/脏稿和提交忙态 | T07；UI-028（同源销售退货） |
| `frontend/src/pages/sale/RepeatSaleRecoveryPage.tsx` | 空恢复态说明当前账号/服务器归属，原记录不清不重发 | T08；UI-004 |
| `frontend/src/pages/sale/commercial/CommercialEditor.test.tsx` | 补添加商品/套装真实前提提示及既有ordinaryOnlySave行为回归 | T07；UI-003 |
| `frontend/src/pages/sale/commercial/CommercialEditor.tsx` | 按真实仓库/商品查看权限说明添加前提，不增加客户门槛 | T07；UI-003 |
| `frontend/src/pages/sale/components/ReserveAllocationDialog.tsx` | 五身份列compact、缩窄核心列并补可键盘进入的横滚说明 | T05；UI-001 |
| `frontend/src/pages/settings/index.test.tsx` | 补待处理禁用/单次提交/原表单值与只读边界 | T07；UI-126 |
| `frontend/src/pages/settings/index.tsx` | 原唯一保存/取消操作改为sticky ActionBar，保原配置字段与值 | T07；UI-126 |
| `frontend/src/pages/settings/print-templates/editor.test.tsx` | 补延迟水合首载fit、隐藏再激活与手动缩放优先回归 | T16；UI-113/114 |
| `frontend/src/pages/settings/print-templates/editor.tsx` | 以canvasReady覆盖旧模板水合后的fit/Observer附着，保手动缩放算法 | T16；UI-113/114 |
| `frontend/src/pages/settings/printers/index.tsx` | 类型按代码映射→API名→未知回退，别名输入补px-2 | T16；UI-116/117 |
| `frontend/src/pages/sorting-bins/index.tsx` | 删除为危险描边次动作，保原删除确认/权限/handler | T10；UI-046 |
| `frontend/src/pages/stockcheck/abc.tsx` | 规则编辑/保存组移到规则条；按页签说明仓库与已分档覆盖口径 | T09/T10；UI-034/036 |
| `frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx` | 固定标题页脚、单正文纵滚，compact身份列与实盘数量首屏空间 | T05；UI-033 |
| `frontend/src/pages/supplier-refunds/CreateRefundPage.tsx` | 无效来源增加按权限返回采购退货/退款列表，保原来源与请求 | T07；UI-061 |
| `frontend/src/pages/supplier-refunds/RefundRecoveryPage.tsx` | 空恢复态说明当前账号/服务器归属，不清历史未知结果 | T08；UI-062 |
| `frontend/src/pages/supplier-refunds/index.tsx` | 说明列表沿当前查看权限和仓库范围，保现有退款流程 | T08；UI-060 |
| `frontend/src/pages/transfer/index.tsx` | 显示实际自定义创建日期chip，移除回本页默认而非改全局默认 | T09；UI-042 |
| `frontend/src/styles/desktop-page-samples.css` | 仅桌面浅色错误toast混色为不透明；保原dark/PDA/登录排除作用域 | T16；UI-115 |
| `frontend/src/test/businessExplanation.test.tsx` | 新增日期chip/期末/历史四位/成本例外/库龄0与缺值等说明合同 | T09；UI-042/048–051/069/073/093/096 |
| `frontend/src/test/financeQueryDialog.test.tsx` | 新增资金三页查询壳、焦点/取消/草稿/日期默认与重置合同 | T06；UI-055/058/059 |
| `frontend/src/test/pageActionReachability.test.tsx` | 新增保存区/返回/脏稿异步归属和忙态负例；夹具补closable | T07；UI-028/040/061/124/126 |
| `frontend/src/test/recoveryEmptyState.test.tsx` | 新增恢复空态、归属提示与无自动办理行为合同 | T08；UI-004/041/062 |

### 3. GitHub PR交付与历史未提交快照

独立验证方优先在自己的验收副本取PR最新Head，记录完整SHA；不要操作GPT现用工作树或覆盖其他任务内容。取得分支的跑法（由验证方执行）：

```bash
git fetch origin codex/ui-audit-remediation-20261027
git switch --detach FETCH_HEAD
git rev-parse HEAD
```

下列忽略产物是上一轮未提交阶段的本机历史快照，不随PR上传，不能替代本PR最新提交。只有需要复核历史快照且本机确实保留它时才使用：

- `output/ui-audit-remediation-20261027/muse-handoff/changed-files.tar.gz`：101个改动文件的当前内容，包含19个未跟踪新增文件；不是只含`git diff`的半份交接。
- `manifest.json`：每文件相对路径、大小、SHA-256、审计对应、基线和分支；用于标识Muse实际拿到的代码。
- `tracked.patch`：已跟踪文件的二进制安全差异，供阅读；不要同时套patch又覆盖同一批文件。
- `bundle.sha256`：变更归档的SHA-256。归档仅含上表白名单文件，不含`.env`、生产配置、凭据、数据库、`node_modules`、历史截图或构建产物。

Muse可在自己空的验收目录取得基线后，覆盖本批文件；下面只给跑法，GPT本轮不执行：

```bash
set -euo pipefail
# 从当前工作树运行；MUSE_ACCEPTANCE_ROOT须指向尚不存在的新验收目录。
: "${MUSE_ACCEPTANCE_ROOT:?请先指定新的验收目录}"
if [ -e "$MUSE_ACCEPTANCE_ROOT" ]; then
  echo '验收目录已存在，停止，避免覆盖其他任务内容。' >&2
  exit 1
fi
MUSE_HANDOFF_DIR="$PWD/output/ui-audit-remediation-20261027/muse-handoff"
(cd "$MUSE_HANDOFF_DIR" && shasum -a 256 -c bundle.sha256)
mkdir -p "$MUSE_ACCEPTANCE_ROOT"
git archive 137e2e44d6d696d3929ea61c75992549a09a4fe3 | tar -x -C "$MUSE_ACCEPTANCE_ROOT"
tar -xzf "$MUSE_HANDOFF_DIR/changed-files.tar.gz" -C "$MUSE_ACCEPTANCE_ROOT"
cd "$MUSE_ACCEPTANCE_ROOT"
if [ -f "$HOME/.config/flowcube/dev-env.sh" ]; then
  source "$HOME/.config/flowcube/dev-env.sh"
fi
npm --prefix backend ci
npm --prefix frontend ci
# 仅在需要Windows/Electron源码验收的副本中再安装桌面端：
# npm --prefix desktop ci
```

Muse记录归档摘要和manifest摘要，并按清单重新计算文件摘要，避免把基线SHA当成修复快照身份。新验收目录不要复制当前机器的真实`.env`或私有登录态。

### 4. 待极序验收 + 极序测试代 Muse 验证清单

五项共用分支`codex/ui-audit-remediation-20261027`与本PR最新Head；状态均为**待极序验收 + 极序测试代 Muse 验证**，本节没有独立验收结论。

#### 4.1 角色 / 缩放矩阵 — 待极序验收 + 极序测试代 Muse 验证

- **分支/源码**：上述分支的PR最新Head；权限入口见`frontend/src/router/routeDefinitions.ts`、`frontend/src/lib/permission-codes.ts`；本批未修改角色权限表或路由准入定义。
- **启动跑法**：验收副本加载Node22环境，安装对应lockfile依赖；由Muse配置自己的非生产本地API后启动`DEV_API_TARGET=http://127.0.0.1:3000 npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort`。同机已有入口为`http://127.0.0.1:5173/`，是否仍运行及其当前登录状态由Muse确认。
- **角色轴**：从验收实例当前角色/权限导出取实际账号，覆盖全部正式角色；重点管理员、财务、采购、销售、仓库、只读以及限仓/不限仓。不能拿一个全权账号代表全部角色，也不为测试临时扩大现有权限。
- **缩放轴**：至少100%/125%/150%，并覆盖Muse实际目标设备提供的其余业务缩放档；浏览器真实缩放、Windows显示缩放分别记录。窗口1366×768、1440×900、1920×1080；CSS等效视口不能填成真实125%结果。代码沿既有flex/grid、min-height及滚动区，不新增缩放开关。
- **页面/操作**：`#/assistant`（欢迎、短聊、长采购/分配、消歧、多账户、暂停、过期、未知、刷新/隐藏再激活）；`#/sale/new`与草稿详情占库弹窗；`#/stockcheck`详情30行；`#/users`1/12/30角色；`#/approvals/flows`1/5/10节点；`#/settings`、`#/permissions`滚底保存；`#/finance/accounts`、`#/finance/transactions`、`#/finance/expenses`查询及100行账户流水；`#/returns/purchase/new`、`#/returns/sale/new`及无效/不存在详情；`#/disposals/new`、`#/supplier-refunds/new`无效来源。
- **其余样板**：`#/inventory/trace`、`#/locations`、`#/payments/receivable`、`#/payments/payable`、`#/reports/reconciliation/receivable`、`#/reports/reconciliation/payable`、`#/reports/wave-performance`、`#/reports/pda-anomaly`、`#/reports/warehouse-ops`、`#/reports/profit-analysis`、`#/reports/inventory-aging`、`#/accounting/vouchers`、`#/accounting/reports`。记录正常/加载/失败/空/截断/长内容、焦点末项、取消重开、返回原筛选、后台刷新不清草稿、保存忙态与只读无写入口。

#### 4.2 真实库 / 真实API — 待极序验收 + 极序测试代 Muse 验证

- **分支/源码**：上述分支的PR最新Head；后端入口`backend/index.js`，小满在同进程`/api/assistant`，不需额外Agent端口。业务接口/迁移沿当前源码；本批没有数据库迁移或财务/库存SQL修改。
- **配置前提**：Muse使用自己有归属证明的独立MySQL8验收库，显式`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/JWT_SECRET`，并配置可写`APP_UPDATE_DOWNLOADS_DIR`、独立`AGENT_DATA_DIR`；真实模型另配`AGENT_MODEL_BASE_URL/AGENT_MODEL_NAME/AGENT_MODEL_API_KEY`。敏感值只在验收方私有环境，不进入交接/日志。
- **现有本机环境的限制**：上一轮启动器`~/.config/flowcube/local-preview/ui-audit-dev-20261028/start-backend.cjs`指向旧副本`flowcube_ui_preview20261008_1735_test`，历史迁移记录到282；不得把它当本批现行schema的真实库验收环境。旧`admin`凭据此前未能登录；GPT本轮不重试、不重置或启用账号。Muse准备有效授权账号与当前schema，不能靠前端免登录种子或合成GET白名单代替。
- **库结构跑法**：在Muse独占验收实例上，对照`backend/src/database/*.sql`、`db_migrations`和`information_schema`核现行结构（含当前目录的`297_fix_builtin_product_label_layout.sql`）；需要补迁移时只对该验收实例显式执行`npm --prefix backend run migrate`。不运行面向共享`flowcube_dev8`的`dev:mysql8:migrate`，不把当前预览库顺手升级，不向生产执行写入。
- **应用跑法**：在已注入上述私有验收配置的副本里，`LOGISTICS_WORKER_ENABLED=0 DINGTALK_ALERT_WEBHOOK= npm run dev:backend`；前端代理指向同一个验收API。采用完整业务API，不挂合成API替身。需要正常worker的场景由Muse在其专属环境按主题文档配置，不能将外呼默认为已阻断证据。
- **数据/页面入口**：为`#/assistant`准备真实API可见的两个仓、整数/小数商品、长名称、真实价目来源、多候选客户、两个收款账户、未结应收和月结/现结各自样本。核口语→预览→改量/放弃、旧revision、原任务未知恢复、跨标签/刷新/存储故障、原文客户/金额/指定单号/日期拒绝边界、两段收款各自确认及原回执；从`#/inventory/trace`、`#/sale/:id`、`#/payments/receivable`、客户往来页回查对应原对象。测试订单与账款不能使用真实客户资金。
- **现成回归入口供Muse选择**：`npm run smoke:finance`、`npm run smoke:accounting-period`、`npm run smoke:operation-request-concurrency`、`npm run smoke:warehouse-scope`、`npm run smoke:sale-adjustment`，运行前按`docs/verification-commands.md`落实`NODE_ENV=test`、回环、专属`flowcube_<用途>_test`及归属边界；不要把含清理的smoke丢到共享3306/3307。本批入口守卫及全套范围以该文档为准。

#### 4.3 CI — 待极序验收 + 极序测试代 Muse 验证

- **分支/源码**：上述分支的PR最新Head；不能用起始基线SHA、其他分支或main的绿灯为本PR背书。
- **配置入口**：`.github/workflows/test.yml`的`static`已调用`npm run test:agent`、前后端lint、`tsconfig.app.json`和前端单测；`browser-smoke-runtime`包含`test:style-compat`；`regression`及owned jobs为实际库链入口。本批未改工作流、发布凭据或触发条件。
- **Muse直接可跑的同配置步骤**（在完整快照副本，Node22，依赖按lockfile安装）：

```bash
npm --prefix backend run lint
npm --prefix frontend run lint
./frontend/node_modules/.bin/tsc --noEmit -p frontend/tsconfig.app.json
npm --prefix frontend run build
npm --prefix frontend run test:unit -- --maxWorkers=2
npm run test:agent
npm run test:frontend-conventions
npm run test:frontend-date-source
npm run test:frontend-polling-contract
npm run test:api-route-contract
npm run test:route-permission-contract
npm run test:permissions
npm run test:agents-md-guard
npm run test:style-compat
```

- **真正云CI入口**：本轮已获准提交/推分支/对main开PR，由PR自动触发原Tests及Security Scan流程。验证方核run关联的PR Head SHA（PR合并测试引用须同时记录head与base），保留job/attempt和日志。GPT可以跟进自动检查并修本PR范围内失败，自动检查的绿灯不替代极序验收与极序测试的五项独立验证；不手动触发部署或设备发布流程。
- **设备构建工作流**：`build-pda-apk.yml`、`build-desktop.yml`带main/历史SHA/tag与部署前置门，不适合给本地未提交代码“借一次发版”验收。Muse记录run URL、完整源码身份、job/attempt、失败日志/未跑项；不要用现行`v0.14.0`版本号代替本批快照身份。

#### 4.4 真机 — 待极序验收 + 极序测试代 Muse 验证

- **分支/源码**：上述分支的完整快照；`frontend/capacitor.config.ts`、`frontend/android/`和`desktop/main.js`沿原配置，本批没有原生能力变更。依赖使用同一快照lockfile；Node22/Java21/Android SDK按现行开发环境配置。
- **PDA跑法**：在Muse独立副本运行`npm --prefix frontend run pda:sync`，再在该副本`frontend/android`运行`./gradlew :app:testDebugUnitTest assembleDebug`；APK入口`frontend/android/app/build/outputs/apk/debug/app-debug.apk`，由Muse通过既有安装方式装到授权测试设备。同步/生成物留副本，不覆盖当前工作树的Android产物。
- **PDA页面**：原生服务器设置指向Muse验收API，沿现有设备绑定/仓库/登录流程进入`/pda/bind`、`/pda/login`、`/pda/inbound`、`/pda/putaway`、`/pda/stockcheck`；设备实际扫码、键盘/焦点、返回/重开、网络切换、限仓会话与桌面CSS不侵入PDA均由Muse记录。浏览器PDA视口不计真机。
- **Windows桌面跑法**：在Muse Windows副本按lockfile安装desktop依赖，先`npm --prefix frontend run build`，再`npm --prefix desktop start`。当前`desktop/main.js`开发态载入同副本`frontend/dist/index.html`，不从5173取页面；在应用现有服务器设置里选择验收API，不能沿旧生产地址。该方式为源码桌面运行，安装包/自动更新若要验收，须由Muse取得与本快照一致、另行获准制作的产物，不运行发布脚本。
- **记录项**：Windows/PDA型号、系统、应用源码摘要、APK/renderer摘要、权限/仓库、真实缩放与设备交互；涉及小满状态时沿`/assistant`保原任务ID与两段确认。结果栏由Muse独立填写。

#### 4.5 出纸 — 待极序验收 + 极序测试代 Muse 验证

- **分支/源码**：上述完整快照，先按4.4启动Windows源码桌面；物理打印依赖桌面IPC/本机驱动，单独浏览器预览不能出此结论。
- **配置入口**：`#/settings/printers`从本机选择真实测试打印机和驱动/RAW通道，按既有仓库/工作站绑定；查看/管理分别沿`print.printer.view/manage`，模板沿`print.template.view/manage`。不扩大验证账号权限，不把未知类型显示回退当驱动支持。
- **页面/跑法**：`#/settings/print-templates`打开已有A4模板`#/settings/print-templates/:id`，由Muse观察首载fit、手动缩放、隐藏再激活；保存试验使用验收方样本副本。用现有打印预览/打印入口做A4文字、边距与长内容出纸；标签使用有仓库/打印机映射的原业务打印入口，补打只从`#/settings/barcode-print-query`进入，不在销售页另造条码按钮。
- **事实链**：Muse分别记录模板/任务ID、份数、队列→工作站领取→RAW提交/回执→实际纸张照片或扫码可读结果；核同键重试/恢复没有多打，不靠DONE回执推断纸张。未连接设备或驱动时保留待验，不写出纸结论。
- **自测材料入口**：`npm run test:label`、`npm run test:print`、`npm run smoke:print-queue`、`npm run smoke:print-template-preview`仅供Muse在其独立环境选择；它们也不替代物理出纸。

### 5. 验证方填写结果与GPT本轮边界

| 交接项 | 验证方 | 结果状态 | 证据待填 |
|---|---|---|---|
| 角色/缩放矩阵 | 极序验收 + 极序测试（代Muse） | 待验证 | 实际角色权限/仓范围、真实缩放、页面状态与截图 |
| 真实库/真实API | 极序验收 + 极序测试（代Muse） | 待验证 | 实例归属、schema、请求/任务/回执和原对象对账 |
| CI | 极序验收 + 极序测试（代Muse） | 待验证 | 快照摘要或获准ref、run/job/attempt、完整日志 |
| 真机 | 极序验收 + 极序测试（代Muse） | 待验证 | 设备、系统、安装/renderer摘要、真实操作 |
| 出纸 | 极序验收 + 极序测试（代Muse） | 待验证 | 驱动/打印机/任务/份数、RAW回执及纸张证据 |

上一轮交接仅作代码/配置读取、逐文件归类、交接物生成和文档自查。本轮GPT负责按授权提交/推送/开草稿PR及跟进自动检查，不点页面、不操作设备或打印机、不执行真实库验收，不代替验证方给出验收通过结论。前文4002/412/156等历史数字保留其原阶段，不改写成Muse结果。本轮交接生成器对101个文件建立一一映射，机械清单检查与`git diff --check`的退出状态另见本地交接产物，不作为产品验证结论。现有开发服务保持用户上一轮要求的状态，GPT本轮不替Muse登录或更改账号。

### 6. 本轮推审边界与基线说明

- 2026-10-28已fetch核对：origin/main为`137e2e44d6d696d3929ea61c75992549a09a4fe3`，本分支起点与其一致。远端该提交三端package版本均为`0.14.0`，与本次提示中的`0.13.7`不同；本PR仅沿用远端已有版本，未升降版本，不回退其他发布线。
- 提交范围为上表101文件；输出快照、凭据、`.env`、node_modules、构建产物不纳入。T15未动，已有数据库迁移脚本不改，也不删数据。
- 本PR不合并、不打tag、不发版。等待极序验收 + 极序测试代Muse完成五项独立验证，老大再决定后续动作。请@极序验收开代码验收，请@无敌霸王龙协调测试群按五项开验；本段为交接要求，不表示GPT已向群发送消息。
- PR #103首轮自动检查在`test:copy-conventions`命中本批两句新增文案：T03放弃结果提示的“正在读取”改为“正在加载”；T09/ UI-036覆盖说明的内部词“容器”改为“库存条码”。仅统一文案，不改任务恢复、查询/统计口径、权限、T15或守卫规则；后续以本PR最新提交的自动检查结果为准，独立五项仍待验证方执行。

代码已就绪，待极序验收 + 极序测试代 Muse 验证。


### 2026-10-30 PDF复核续修

用户先要求核查 PR103 PDF，再授权开始修复。15编号归并8组，已在原分支实现；S1/M5吸顶与S2/S4动画透字未作为稳态缺陷加全局补丁。8文件71组件用例、lint、应用类型检查、build及约定/样式守卫通过，局部真实页面已复核；完整角色/设备/出纸仍待验。详见 [逐组修复与证据边界](../../pr103-ui-followup-2026-10-29.md)。本批未提交、推送、合并或发版，前文历史CI结果不代表本批新改动。
