# 工作区标签栏键盘与语义验证

本轮仅修改 `frontend/src/components/layout/WorkspaceTabs.tsx` 并新增 `WorkspaceTabs.keyboard.test.tsx`；未改 workspaceStore、dirtyGuardStore、KeepAliveOutlet、AppLayout 或公共样式。页面与数据来自主任务现有本地开发栈 `http://127.0.0.1:5186` 的合成验收数据。

原实际 DOM 的标签为不可聚焦的 `div[role=tab]`，缺少 tablist，关闭按钮嵌在 tab 内且 `tabIndex=-1`。实际 axe 4.12.1 在商品管理、仪表盘/销售/商品三标签状态发现 `aria-required-parent`（3 节点）和 `nested-interactive`（2 节点）。

本地修正把 tab 改为原生按钮，关闭按钮为同级独立按钮，活动 tab 使用 roving tabindex。tablist 用 `aria-owns` 关联实际 tab，关闭按钮保持在 tablist 所属集合之外；直接把独立关闭按钮放进 tablist 会产生 `aria-required-children`，本轮真实复扫发现后另补红/绿回归并修正。左右键循环选择并导航，Home/End 选首末，Enter/Space 选择聚焦的标签，Delete 使用原关闭与未保存守卫。菜单保留原关闭其他/全部流程，增加方向键/Home/End、Escape 和回焦。

## 代码与行为回归

- 首轮 9 个真实 MemoryRouter/workspaceStore/dirtyGuard 测试：修改前 8 失败、1 通过，失败原因为缺少 tablist、键盘切换/关闭/菜单入口无效；日志 `/tmp/flowcube-workspace-tabs-red.log`。
- tablist 所属角色补核：修正前 1 失败、9 通过；日志 `/tmp/flowcube-workspace-tabs-ownership-red.log`。修正后新增 10 项全部通过。
- 最终本批专项：`npx vitest run src/components/layout/WorkspaceTabs.keyboard.test.tsx src/store/workspaceStore.test.ts src/hooks/useWorkspaceTabTitle.test.tsx src/components/shared/KeepAliveSection.test.tsx`，4 文件 / 23 用例全部通过；日志 `/tmp/flowcube-workspace-tabs-regression.log`。
- PDA 浏览器验证窗口关闭后，仅把菜单危险纯文本和关闭按钮 hover 的 `text-destructive` 改为 `text-destructive-ink`。同4文件23例再次通过（380ms），组件与测试 scoped ESLint 通过；日志 `/tmp/flowcube-workspace-tabs-ink-regression.log`。下文 GUI/axe 属于这次颜色微调之前，微调后未由本任务重新打开浏览器，统一 after 可补充视觉证据。
- `npx eslint src/components/layout/WorkspaceTabs.tsx src/components/layout/WorkspaceTabs.keyboard.test.tsx` exit 0；`git diff --check` exit 0。全量前端、类型与构建由主任务统一执行，本报告不代替那些结果。

## 实际浏览器样本

使用独立命名会话 `flowcube-impeccable-tabs`，没有复用或关闭其他任务浏览器。

- 三标签真实 DOM：`tablist` 存在，所有 tab 为 BUTTON，当前商品 tabIndex=0，其余 -1；独立关闭按钮 tabIndex=0，tab 中无嵌套 button。
- ArrowLeft 从商品转销售，保留销售列表原 `endDate/startDate` 查询，焦点与 aria-selected 留在销售 tab；Home 到仪表盘、End 回商品。真实 Space 从聚焦商品 tab 选择商品，Enter 从聚焦销售 tab 选择原销售查询。
- 标签操作 ArrowDown 打开并聚焦“关闭其他标签”；Escape 关闭菜单并回“标签操作”。
- 从销售列表点“新建销售”，在备注中输入合成验收草稿；Delete 打开真实“离开确认”，点“继续编辑”后仍在 `/sale/new`，焦点回新建 tab，备注完整保留。ArrowLeft 切商品、End 返回原新建页，备注仍完整保留。
- 再次 Delete 并确认，关闭该前端临时草稿，回到 `/sale` 并聚焦销售 tab；未点击“保存草稿”，未写入业务单据。销售/商品列表标签保留。
- 焦点到“关闭 商品管理”后 Enter，关闭非活动商品标签，销售原查询与焦点保持。
- 商品管理同路由、同三标签、同合成商品列表、同视口的修后 axe：0 violations、0 incomplete。该结论仅属于这次实际页面状态；截图前后的通知数有后台变化。

证据文件：`workspace-tabs-before.png`、`workspace-tabs-after.png`、`workspace-tabs-draft-cancel.png`、`workspace-tabs-axe-before.json`、`workspace-tabs-axe-after.json`。

浏览器收尾：`agent-browser --session flowcube-impeccable-tabs close` 后再次 `agent-browser session list --json`，只剩 root/a/b 三个其他任务会话，本任务会话已退出。

## 验证边界

静态覆盖清单保持各路由/表面的初始“未查看/未执行”，本样本不可自动升级为所有共享用方通过。未验证 Windows Electron 原生确认、屏幕阅读器、所有动态表单/来源 query、所有业务页或真机/打印。本轮保留原关闭归属解析与 store 合同，详情关闭的组件回归使用无来源 query 的 `/sale/42`，实际浏览器关闭使用 `/sale/new`。

## 最终稳定会话补验

最终 canonical Radix 为 dismissable-layer1.1.13 / focus-scope1.1.16。复用 `flowcube-impeccable-crud`，1024×900浅色。真实新建销售选择客户和两个合成商品、数量1.25/2、备注；切仪表盘再返回，客户、两行数量与备注保留。点击具名独立“关闭 新建销售单”产生离开确认，继续编辑保留原草稿；再次关闭并确定离开，原新建标签移除且回销售列表。未保存订单。

`observations-workspace-final.json` 的5图均逐张人工细看。取消后的即时DOM采样曾为BODY，因此另建只含备注的草稿，条件等待弹层退出的自动回焦，实际回原close按钮，值保留；该1图与DOM在 `observations-c-final-shared.json`。即时BODY不被提升为持续焦点缺陷。root较早HMR环境的close无反应也未在这次稳定新上下文重现，保留原条件记录，不能仅据这次成功判断所有HMR状态。

公共Dialog、BaseCrud、A独立guard、WorkspaceTabs、DatePicker最终5文件47例通过，日志 `/tmp/flowcube-dialog-focus-final-green.log`；包括标签10例，其余夹具不替代本标签真实GUI。后续Description属性收口与DataTable变更不由这批图证明。finally关闭后独立list只剩root/B，无本任务会话。
