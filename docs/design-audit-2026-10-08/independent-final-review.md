# C独立最终源码审查与覆盖边界

审查基线66fa87e、当前冻结工作树。范围为DataTable/列宽类型与11备注用方、statusTone/ink、八BaseCrud/独立表单草稿与权限、WorkspaceTabs、FinderTable/SaleHeader/QueryForm、公共Dialog/AppDialog/DatePicker单例及供应商退款。未发现最终这些改动新增的P0/P1源码阻断。修复不等于所有1150调用候选验收；本文件只核对下面实际源、调用链和明确证据。

## 最终源结论

- DataTable纯归一百分比取有效正权重，原total104只归一、保留相对关系；业务96/操作128的下限与选择56纳入table minWidth。保存的像素列宽、resize真实RAF预览/取消/提交、原存储格式和选择合同保持。Chrome初版COL calc均分被B真实证伪，最终源无calc；opaque sticky hover的实际背景及最终正常reload选择列56、业务384/127.984/128.016由B精确DOM/7图支持，不把jsdom样式当排版通过。
- 11个expandableText定义只在remark。完整原文字在DOM，原生details/summary有名称与焦点样式；身份名称/型号/单号不收起。虚拟行高度测量及双击停止冒泡保持。销售代表样本已看，另外十个定义的全部文本/键盘/虚拟/主题条件没有因此通过。
- BaseCrud的原生form允许真实Radix BubbleInput进入change脏状态；programmatic回调由markDirty补齐，locked及canEdit阻止Portal迟到回填。pending/隐藏成功保持原表单和工作区守卫，写权限按create/update/delete独立隐藏并二次检查。八用方真实代表输入、取消/继续/放弃/重开已实走；塑料盒真实选品+仓库及各单独变化确认保留。pending/隐藏/低权限主要夹具证据，不冒称真实业务提交。
- useDialogFocusReturn同时覆盖标准DialogContent和直接原语AppDialog，调用方显式草稿handler先执行并保留preventDefault优先权；失活/隐藏/断开/禁用不抢焦。原BaseCrud继续编辑持续BODY失败与fresh八用方回原字段成功分别保留。最新salesclose刚卸载的BODY即时采样另经条件等待证实原close按钮回焦，不判持续失败。
- DatePicker input位于独立日历button之前，保留合法解析与min/max；内层Escape仅关闭日历，closeAutoFocus回input且抑制再打开，失活/disabled检查保留。exact layer1.1.13/scope1.1.16、npm overrides及Vite/Vitest dedupe共享同声明；Vitest真实Radix inline解析一致。1.1.19真实嵌套Escape自然失败与修后47例、768真实2→1→0保留，不将旧同步timeout/无效CSS focus算产品red。
- RF两个已有业务说明各自成为DialogDescription，准确Radix目标存在；BaseCrud/Customer无purpose说明的Content显式aria-describedby undefined，没有全局屏蔽合法描述。root RF1浅深各37pass/0violations/1incomplete与Tab/ShiftTab/Escape回原单号按钮已登记；历史1contrast violation与0violations/2incomplete仍保留。其他用方没有由此取得axe通过。
- FinderTable当前合法grid/row/header/cell所属，方向键移动焦点、Enter选择与Space确认保持原read准入；ProductFinderModal为另一实际组件。SaleHeader实例ID绑定与八名称已核，条件发货字段双实例修正保留原业务；该条件分支无本任务GUI。QueryForm最小列、child min-w-0/full span不改查询口径。
- statusTone只改相同语义的ink前景，10%底/20%边保留；18计算例与代表浅深图支持指定背景，不替代94文本用方各自alpha/disabled/语义。供应商退款展示用原单身份/单号、原四位金额与分配，不重写request key/operation UUID/fingerprint/回执或资金库存会计规则。

## 本任务实际证据

C after64图全部逐张人工看：八CRUD44、focus8、extras3、销售草稿5、最终canonical关键4。销售实际客户+两商品qty1.25/2+备注切dashboard/返回保留；close确认、Continue保留、再次close/确定离开回列表且tab移除，无保存。供应商only-Radix变化、日期两层Escape与客户独立guard回焦均有具名真实操作。

47例最终公共焦点/草稿/标签/DatePicker专项通过；本任务8路径scoped ESLint exit0。root全量260文件1877例、类型/lint/build的最终日志由root独立汇总。A119图、B明确PDA阶段/分配/选择夹具、root108入口总览+16末轮+16fluid图各按自己的声明合入；截图文件存在不能升级人工查看。C finally close后独立list无C，末轮全局list为[]，没有结束他人会话。

## 剩余优先验收

| 优先级 | 限定剩余范围 | 现有证据与不能外推的部分 |
| --- | --- | --- |
| 优先1 | 提交在途、隐藏迟到结果、撤权/低权限、unknown原请求恢复 | 已有真实组件/延迟夹具；没有逐业务用方实际写入GUI，不要求为视觉审查制造资金/库存写入 |
| 优先1 | 动态合法阶段与范围 | ERP13动态中11有实际资源/路径标题，10仅总览、procurement1代表详情；transfer真实403保留范围，不扩大权限；logistics无合法fixture。PDA receive2/putaway1与2/task1有具体阶段，check/pack1只是阶段禁止、ship1只是扫描初态且源码不消费routeID；其余合法可执行阶段仍缺 |
| 优先2 | 1095尚无指定条件人工查看/交互的业务调用候选 | 候选保留七态的源码线索/待核及未覆盖原因；55有代表证据也没有全状态或全部relatedRoutes通过。A独立弹窗、八CRUD等已实走项不再笼统待验 |
| 优先2 | 备注11用方、94文本背景、屏幕阅读器/aria-hidden-focus incomplete | 销售/ERP/PDA代表样本与token计算有证；各用方全主题/alpha、虚拟长文、完整读屏与incomplete仍须限定验收 |
| 外部验收 | Android广播/相机/软键盘/实体返回、Windows原生、物理打印、CI/部署 | 本轮浏览器/本地组件证据不能替代硬件、发布或生产证明；/pda/login未登录代表态仍缺 |

模板真实400仍按原格式错误呈现，不放宽业务规则；合成资金勾稽差额未据此改账务。两项需业务另行决定，不属于本轮界面实现失败。完整问题来源F01–F17、每条route/surface证据、状态与修改范围见coverage.json；evidenceIndex关联精确来源。
