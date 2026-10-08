# Assessment A：独立浮层补验与修补

2026-10-08。本报告追加到 `assessment-a.md`、`a-after.md`、`a-backend-read.md`，不改写它们原有的 67 张 after / 56 例前端专项口径。A 未读取 B 结论。环境为本批专属临时实例、合成记录、回环 Vite 5186 / API 50060；没有生产、真实银行、实际打印或设备结论。

## 本轮改动与证据

| 文件 | 改动与边界 |
| --- | --- |
| `frontend/src/hooks/useDialogDraftGuard.ts` | 为独立表单提供脏草稿关闭确认、同步提交锁、打开/记录/可见性代次守卫及“继续编辑”回焦。复用现有 ConfirmDialog；不接管业务 API、权限或成功回执。 |
| `pages/customers/components/CustomerFormDialog.tsx` | 输入和程序 selector 回填均计入脏草稿；取消/Escape/关闭先确认；同 id 刷新不抹草稿；提交中锁住输入，迟到回调不关闭新草稿。保留原客户结算与授信业务。 |
| `pages/users/components/UserFormDialog.tsx` | 保护用户表单未保存输入、提交中锁定和迟到回调；保留既有角色、可分配权限与本人资料逻辑。 |
| `pages/accounting/invoices/index.tsx` | 发票录入 9 处标签关联真实控件；脏草稿与尚未 blur 的日期输入保护。保留原 revision/409 复制后关闭重开策略。列表失败显示原错误和真实重试，隐去头尾零/旧汇总。 |
| `pages/approvals/flows.tsx` | 首部 4 字段与逐级审批人字段关联控件；独立表单保护和提交锁；不改审批规则或 payload。 |
| `pages/settings/pda-devices/index.tsx` | 登记/编辑设备名称、所属仓库标签关联控件。只改字段名称，未调整改绑、启停、认证或设备业务。 |
| `pages/finance/transactions/index.tsx` | 查询的资金账户、关键字、业务类型、收支方向、发生日期起止标签关联控件。 |
| `pages/settings/print-templates/index.tsx` | 真实列表读取失败显示 QueryErrorState、原错误和 refetch；缓存失败不继续显示旧表。非法 label 业务格式拒绝仍保留。 |

上述 `pages/` 路径均相对 `frontend/src/`。共享 BaseCrud、ConfirmDialog、ui/dialog、DatePicker 属其他 agent，本轮没有修改它们。

## 自然 red / green

| 证据日志 | red 或修补过程 | 最终 green |
| --- | --- | --- |
| `a-independent-dialogs-red.log` | 16/16 自然失败：客户/用户取消、Escape、关闭直接丢草稿；同 id 刷新抹草稿；提交中控制失守；5 组控件标签缺失；发票/审批流 Escape 丢草稿。 | `independentDialogs.draft.test.tsx` 当前 19 例。 |
| `a-independent-selector-red.log` | 1 failed / 17 passed：提交前捕获的 selector 回填改变提交中结算草稿。 | 增加回调代次/提交锁检查后通过。另一程序回填脏草稿用例原已通过，不计新增 red。 |
| `a-read-followup-red.log` | 5 failed / 18 passed：打印模板和发票各 2 个首载/缓存失败测试，以及日期未 blur 原始输入关闭保护测试自然失败。 | `readFailureFollowup.test.tsx` 4 例及日期保护用例通过。 |
| `a-invoice-existing-regression.log` | 既有 409 套件 3 failed / 3 passed：旧用例把“取消”当无条件关闭。按本批新保护行为显式确认“放弃修改”，未削弱 revision/409 断言。 | `invoices/index.409-recovery.test.tsx` 6 例通过。 |
| `a-invoice-date-draft-red.log` | 早期真实日历焦点测试超时，属于测试探索失败，**不作为自然 red 产品证据**。最终日期原始输入用例只隔离输入未 blur；共享日历的焦点与 Escape 另由所属 agent 专项覆盖。 | 不以此超时日志证明修复。 |

最终 `a-independent-dialogs-green-final.log`：5 文件 / **42 例**，包含新增独立浮层 19、新增读取失败 4、既有客户 11、既有用户 2、既有发票 409 恢复 6。`a-independent-dialogs-lint.log`：11 路径 scoped lint exit 0。`a-independent-dialogs-typecheck-final.log`：完整前端 `tsc --noEmit -p tsconfig.app.json` exit 0。`git diff --check` exit 0。它们不替代全量业务套件、发版或生产验收。

## 实际 GUI 操作（已完成部分）

独立会话 `flowcube-impeccable-a`，1024×768；浅色及通过 DOM `.dark` 标记模拟深色。后者不是产品主题切换操作。本段共有 **25 张 a-followup + 16 张 a-fixed = 41 张新增 PNG，均逐张实际看图**；加上旧报告 67 张为 108 张 A after 图。本段只记录实际入口，未从共享依赖外推。

| 入口/状态 | 实际操作与所见 | 截图前缀 |
| --- | --- | --- |
| 客户编辑 | 备注输入后 Escape 出确认；继续编辑保留输入并回焦备注。现结 selector 改动后 Escape 确认、继续编辑回焦 selector 并保留现结；放弃回列表，服务端原月结 30 天未改。浅/深。 | `a-fixed-customer-*` |
| 用户编辑 | 合成用户列表/可分配角色加载后打开；姓名输入 → Escape 确认 → 继续编辑回焦姓名并保留输入；放弃。当前操作员非超级管理员，账号只读按既有规则保留。 | `a-fixed-user-*` |
| 发票录入 | 实际合法空发票页打开进项录入；9 字段名称可读。输入代码 → Escape 确认 → 继续编辑回焦代码并保留；放弃。浅/深。日期最后复验见下段。 | `a-fixed-invoice-*` |
| 审批流新增、待办 | 流程列表真实空态，打开合法新增；字段名称可读，流程名输入 → Escape 确认 → 继续编辑回焦并保留；放弃。待办真实“没有待你审批的单据”。无既有流可编辑、无待办详情或实际审批。 | `a-fixed-approval-*`、`a-followup-approvals-pending-*` |
| PDA 设备 | 打开本批既有设备编辑和新设备登记，名称/仓库真实可访问名称；浅/深。未改设备字段、未点击登记/保存；干净 Escape 关闭观察到回焦原编辑按钮。 | `a-fixed-pda-*` |
| 资金流水查询 | 实际查询 6 字段名称关联，浅/深，取消关闭。 | `a-fixed-transactions-query-*` |
| 资金账户流水 | 账户流水浮层实际展示既有 4 元记录、PC20261008001、日期 2026-10-08、余额 9996；浅/深，Escape 关闭。该普通支出记录没有详情入口，未虚构详情验收。 | `a-followup-account-flow-*` |
| 客户往来 | 从客户行往来明细打开 `/payments/ledger/customer/1` 独立工作区，真实当前期间空态/0；不是详情弹窗，没有往来明细可打开。未留存当时网络记录，不升级为动态资源 GET 实证。 | `a-followup-customer-ledger-*` |
| 凭证查询、空态、勾稽 | 查询弹窗实际打开，应用关键字后真实空态；勾稽展示资金差额 -4、应付差额 -296.29、应收匹配。未执行会计动作，不据此声称财务一致。 | `a-followup-vouchers-*` |
| 角色权限、设置 | 两者为内联编辑，实际打开、随后取消。角色局部切换后未得到明确脏保护证据，不宣称切换保护或回焦通过。设置未上传/保存/外部调用。 | `a-followup-role-permissions-edit-*`、`a-followup-settings-edit-*` |
| 打印机绑定 | 1024 下先正常水平滚动显示绑定操作，再打开合成 OWN 打印机绑定弹窗。7 个按钮点击即写，全部未点击；浅/深、Escape 关闭。未绑定或发送打印。 | `a-followup-printer-*` |
| 打印模板列表/编辑器 | 列表真实 GET 400 原错误为“标签模板须使用画布布局（elements）或兼容的 ZPL 正文（format=zpl）”；当时旧 UI 错显暂无数据，已补 UI，最新错误/重试见下段。既有模板编辑被该错误阻断，不能视为已验；新建编辑器使用默认画布和合成销售预览数据，未保存/打印。 | `a-followup-print-templates-error-*`、`a-followup-template-editor-*` |
| 物流查询 | 真实空页打开查询，关键字/状态/承运商名称可读；浅/深、Escape 关闭。共享日期补丁后的名称见下段。 | `a-followup-logistics-query-*` |

所有上述业务表单只填写本地输入后取消/放弃；没有创建、删除、审批、入账、出账、打印发送。浮层动画或旧 snapshot 引用导致的一次点击被覆盖时，等待稳定后用真实控件重试；不把这些操作时序当产品失败。

## 最后稳定窗口实测

Root 宣布产品/前端配置冻结后，A 复用同名会话补验；本段 **11 张 a-final 图全部逐张查看**。本报告共 52 张新增，连同旧 67 张为 **119 张 A after 图**。路径清单分别在 `a-followup-screens.json`（原 41 张）和 `a-final-screens.json`（本段 11 张）。

| 实际调用方 | 最后操作及结果 | 证据 |
| --- | --- | --- |
| 打印模板列表 | 真实 GET 400 显示“打印模板加载失败”、完整原格式错误和重试；正常点击重试仍真实 GET 400，同错误保留，没有“暂无数据”或旧表。浅/深。没有放宽非法 label 格式。 | `a-final-templates-read.json` 仅 method/path/status/requestId；`a-final-templates-error-1024-light.png`、`a-final-templates-retry-1024-dark.png`。 |
| 发票列表 | 仅对本会话 `/api/accounting/invoices*` abort（未 stub 返回值），首载出现原网络读取错误和重试；DOM 探针和浅/深图均无“共 0”或“暂无发票”伪空态。解除该唯一拦截、正常点击重试，同 invoiceType=1/page=1/pageSize=200 GET 得到真实 200，恢复合法空态，此时才显示共 0。 | `a-final-invoices-read.json` 两条被中断请求 status=null（不当 HTTP500）及一条真实 200；3 张 `a-final-invoices-*`。缓存旧表失败隐藏由组件测试证实，本次真实库无发票，不声称有数据缓存 GUI。 |
| 发票日期 / 草稿 | 实际 `find label 开票日期 * click` 打开日历，确认两个 role=dialog。稳定填写并明确读取 `2031-01-02`，尚未 blur 时首 Escape 仅剩外层 1 dialog，焦点仍 invoiceDate、原输入值保留；次 Escape 出未保存确认；继续编辑后焦点 invoiceDate、值仍 `2031-01-02`，因日期获焦日历再次打开。最后放弃关闭，无保存。 | 4 张 `a-final-invoice-date-*`，包含首 Escape 后、确认及深色恢复。未从此单个调用方外推全部日期页或原生端。 |
| 物流查询日期名称 | 实际查询弹窗 snapshot 中日期输入名称为“创建日期（起） 打开日历选择”“创建日期（止） 打开日历选择”，不再仅 yyyy-mm-dd；浅/深图确认可见日期名称，Escape 取消。 | 2 张 `a-final-logistics-date-labels-*`。此处只证明名称，不额外宣称所有筛选/日历交互已执行。 |

日期工具探索边界：首轮 semantic fill 在日历刚打开时追加到原值；Meta/Control 快捷键探针不符合预期，随后 agent-browser 悬挂并自行 relaunch 到 about:blank。仅收尾本会话、doctor 无 fail，新同名会话重试；最终图已覆盖为上表明确读取有效值的稳定操作。空白图、无效输入、Done 但值不符的探针均不计通过，未据此归因产品。日志另有 Radix description/deferPointerDownOutside 警告，已报 root 处理依赖 singleton；**本段样本是在后续 dependency override 调整前取得**，不反向证明调整后 GUI。

网络证据规则：CLI 一次原始请求列表意外回显本批合成认证 header，已通知 root 在全员 GUI 结束后轮换该合成会话。未写原始 headers/HAR 到仓库；后续先在本地进程内解析，再输出脱敏 method/path/status。这里没有凭据正文。

本段结束执行 close；第一次紧接 list 尚短暂列出 A，随后第二次 list 明确仅 `flowcube-impeccable-root`，确认本任务已退出。

## 人工边界

- 合成空态无既有审批流、待办、凭证明细；记录业务阶段不足，不能伪造详情。普通 4 元资金记录没有业务详情入口。
- 非法既有 label 模板是源数据/业务格式问题。是否逐条提示、隔离坏模板或修复历史格式需业务决定，UI 没有放宽拒绝规则。
- 不覆盖原生 Electron 确认、真实 PDA、实体打印、真实银行、生产数据、全量读写业务流程。日期测试探索超时、角色切换证据不足和模板编辑受阻均保留边界。

浏览器已关闭且核验退出。任何后续源变动的重验须重新复用命名会话，不能沿用本报告样本的通过结论。
