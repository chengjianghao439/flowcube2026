# PDA 默认「扫码模式」，软键盘只在点击后出现（2026-09-17）

## 决定

按用户要求：PDA 进入作业页**默认就是扫码模式**，软键盘只在用户**主动点击**后才出现。

## 为什么

现场用的是工业 PDA，扫描头以「键盘模式」输出字符，走 `usePdaScanner` 的全局 keydown 聚合
（字符间隔 50ms、最短 3 位、1s 内同码去重）。但扫码拣货页（`/pda/task/:id`）当时把底部
输入框在**进入页面时自动 focus**，并把**整页 `onClick` 也接到同一个 focus**，
扫码结束后还会 `setTimeout(focusInput, 80)` 再聚焦一次：

- 每次进页面、点页面上任何位置、扫完一条码，Android WebView 都会弹软键盘；
- 键盘占掉半个屏幕，把拣货列表和步骤提示挤掉，现场需要反复按返回键收键盘。

其它 PDA 作业页（复核、打包、上架、分拣、调拨、退货上架…）早就在用
`frontend/src/components/pda/PdaScanner.tsx`：默认扫码模式，只有点「手动输入」才渲染输入框。
拣货页是唯一没跟上的页面。

## 改了什么

- `frontend/src/pages/pda/task.tsx`：删掉 `inputRef`/`inputVal`/`focusInput`、`useEffect` 自动聚焦、
  根节点 `onClick={focusInput}`、扫码结束后的再次聚焦，以及底部 `Input` + 「确认」按钮；
  底部改为 `<PdaScanner onScan={handleScan} placeholder="扫描库存条码"
  disabled={scanning || !!finished || 提交被阻塞} onDuplicate={() => err('重复扫码，请稍候')} />`。
  扫码成功/失败后的反馈、`useCriticalPdaAction` 的待确认与恢复、推荐库位行点选拣货全部不变。
- `frontend/src/components/pda/PdaScanner.tsx`：删掉从未生效的 `autoFocus` 入参
  （组件内部根本没读它，留着容易被误当"可以自动聚焦"），头部补上「扫码模式永不聚焦」的说明。
- 其它 PDA 页面与组件未改：`rg` 核对后，除登录页外没有任何页面再用 `autoFocus`，
  也没有页面主动 `focus()` 输入框。

## 验证

| 验证项 | 结果 |
|---|---|
| `frontend/src/pages/pda/task.test.tsx`（新增，5 例） | 绿：进页面无输入框且焦点不在输入框、点扫码区不弹键盘、点「手动输入」才出现输入框并聚焦、手输回车提交后输入框消失、无输入框时扫码枪事件仍能提交、推荐库位行点选仍可拣货 |
| 同一组新测试跑**改动前**的页面代码 | 红：4 例失败（进页面渲染出 `<input>`、点击扫码区后仍无手动输入、扫码枪提交 0 次），确认回归有效 |
| `frontend/src/pages/pda/scanInputMode.guard.test.ts`（新增静态守卫，3 例） | 绿：除登录页外禁止 `autoFocus`；PDA 页面/组件禁止主动 `focus()`；`PdaScanner` 只有一处 `.focus()` 且在 `enterManualMode` 内、不再声明 `autoFocus` 入参 |
| `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit` | 通过 |
| `npm --prefix frontend run lint` | 0 error（5 个既有 warning，均在无关 ui 组件） |
| `npm --prefix frontend run build:pda` | 通过 |
| `npm --prefix frontend run test:unit`（Node 22） | 79 文件 / 389 用例全绿，无新增失败 |
| PDA 全部单测 `vitest run src/pages/pda/` | 8 文件 / 37 用例全绿 |
| 本地开发模式浏览器实测（真实路由 + 真实后端，PDA 设备已绑定） | `/#/pda/stockcheck` 进入后 `input` 数量 0、`document.activeElement` 是 BODY（无自动聚焦，不会弹键盘） |

浏览器实测的说明：本地 `flowcube_dev8` 没有在途拣货任务，且当前本地 UI 账号（`codex_ui_test`，
打包员角色）没有 `warehouse.task.pick` 权限，`/#/pda/task/1` 被 `PdaRoutePermission` 拦成
「当前账号无权访问」，因此**拣货页本身未做浏览器实测**，它由上面的组件级单测覆盖。
验证时按第 1 节授权临时登记的本地验收设备 `Codex键盘验收机0917`（`PDA-260917-DE3F`，北京主仓）
已在 ERP「系统 → PDA 设备」**停用**，设备会话随即吊销；浏览器会话已 `close` 并用
`agent-browser session list --json` 确认退出。

## 未做 / 已知边界

- **未做真机验证**：键盘弹不弹是 Android WebView 行为，本地浏览器只能证明「没有渲染/聚焦输入框」，
  现场效果要在 PDA 上确认；改动要随下一次发版（含 PDA APK）才会到机器上。
- 手动输入仍是**显式按钮**（与复核/打包等页一致），点扫码条本身不会唤起键盘；
  如果要「点扫码条即输入」，需要单独提需求，届时改 `PdaScanner` 一处即可全站生效。
- 拣货页原有的本地 1s 同码去重保留（覆盖推荐库位重复点选），扫码枪路径的 1s 去重仍由
  `usePdaScanner` 负责，两者互不冲突。

## 2026-09-23 后续调整

上面的验证与已知边界记录的是 2026-09-17 版本。i6310pro 真机确认无焦点硬件扫码可用后，v0.10.7 收货上架页曾单独采用「默认硬件扫码，点下方扫码区域才弹出手输键盘」。v0.10.8 已发布后续统一改动，按用户要求采用拣货页样式：拣货、上架、分拣、退回、改单、盘点和库存查询等页面统一使用 `PdaScanner`，只点「手动输入」按钮才弹条码键盘；拣货页输入区上方重复的箭头提示卡已移除。强制扫码页仍保持不允许手输；不增加自动聚焦。现行约定与真机验收边界见 `docs/frontend-pda-conventions.md`、`docs/pda-scanner-broadcast-2026-09-23.md`。

本轮上架偏离库位复核修正：`usePdaScanner` 默认仍在 1 秒内拦截同码；仅 `putaway.tsx` 的 `scan-location` 步骤且已等待偏离确认时，允许相隔至少 300ms 的第二次同源实扫。广播和键盘对同一次扫描的交叉回放仍拦截。回归用例见 `frontend/src/hooks/usePdaScanner.native.test.tsx`；真机上架验收待随下一版 APK 进行。
