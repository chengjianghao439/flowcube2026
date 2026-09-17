# v0.9.21 发布结果（2026-09-18）

## 发布内容（两条并行工作流合并发版）

1. **编辑态与默认态区分 + 保存反馈**（本会话）：编辑弹窗/表单加「编辑中」标识与编辑对象、主按钮统一「保存修改」；系统设置、权限管理、快递账号绑定、盘点 ABC 规则改为默认只读 + 点「编辑」再改，保存后自动回到查看状态；修编辑态误报「未保存」、补采购/调拨新建成功提示。见 `docs/edit-vs-default-state-2026-09-18.md`。
2. **收付款/对账弹窗重构 + 弹窗内日期浮层修复**（并行会话）：六个大弹窗拆为 `components/shared/payments/` 专用组件并统一 `AppDialog` 工作区外壳；`DialogContent` 居中改用 `inset-0 m-auto`、`PopoverContent` 固定视口碰撞边界。见 `docs/payment-dialogs-appdialog-2026-09-18.md`、`docs/dialog-datepicker-popover-clip-2026-09-18.md`。

发布提交：`77f0877`（main），tag `v0.9.21` 指向同一提交；三端版本 0.9.21，PDA versionCode 129。

## 验证结果

- 同 SHA（77f0877）Tests、Security Scan 均 success；`Deploy Browser App` success（服务器日志显示 `flowcube-backend@0.9.21`，迁移无需更新，页面 smoke 门禁通过）。
- `node scripts/verify-live-release.cjs --origin https://jixuflow.com`：**10/10 全部一致** —— 桌面 `latest.json` / `/api/app-update/latest` = 0.9.21（含 sha256 与 notes）、PDA `/api/pda/version` = 0.9.21 / versionCode 129 / 可下载、`/api/health` = ok。
- 桌面安装包由 Windows runner 构建并经 `release-desktop.js` 发布到 `/versions/v0.9.21/`，`sha256=a12b429e14972bc867de20c21fa9f366861c61ce399b067a6969550ad4e83ed7`。

## 遗留问题：GitHub Release 附件未上传（外部故障）

- 现象：tag 构建的「Upload EXE to Release」步骤在 Windows runner 上挂起约 40 分钟（脚本每次上传超时 10 分钟、最多 5 次），为释放并发组（`flowcube-server-deploy`，PDA 构建被它挡住）人工取消了该 run；随后在本机用同一份安装包重试 `scripts/publish-release-asset.cjs`，连续多轮均失败：
  `HTTP 500 {"message":"Error creating asset temp dir" / "Error saving asset"}`（GitHub 附件存储侧故障，与 v0.9.20 那次同类）。
- 影响面：**桌面自动更新不受影响**（客户端读 `latest.json` 与 `/versions/v0.9.21/`，已核对 sha256 一致）；受影响的是 GitHub Releases 页面的手动下载。Release `v0.9.21` 按脚本设计停在**可见草稿**（`isDraft=true`，无附件），不会出现「看起来发布了却没有包」。
- 恢复方式（GitHub 存储恢复后执行，**不要重新构建 exe**）：
  ```bash
  # 同一份字节：本机已留档，或从生产重新下载并核对 sha256
  curl -sO https://jixuflow.com/versions/v0.9.21/FlowCube-Setup-0.9.21.exe
  shasum -a 256 FlowCube-Setup-0.9.21.exe   # 应为 a12b429e…
  GITHUB_REPOSITORY=chengjianghao439/flowcube2026 GH_TOKEN=$(gh auth token) \
    node scripts/publish-release-asset.cjs --tag v0.9.21 --version 0.9.21 \
      --file FlowCube-Setup-0.9.21.exe
  ```
  本机留档路径：`~/.config/flowcube/release-artifacts/v0.9.21/FlowCube-Setup-0.9.21.exe`（sha256 同上）。

## 并发组注意事项（本次踩到）

`build-pda-apk.yml`、`build-desktop.yml`（tag/手动发布）与 `deploy-browser.yml` 共用 `flowcube-server-deploy` 并发组。**GitHub 的行为是：同组新排队的 run 会取消此前所有 pending 的 run**（`cancel-in-progress: false` 也一样）。因此发版时不要在部署未结束时连续排队多个 run：本次 push 触发的 PDA 构建、tag 桌面构建先后被后排队者取消，需要按「部署 → 桌面 tag 构建 → PDA 补跑」串行安排，否则会出现「PDA 静默落后一个版本」。

## 未验证

- 桌面端真机自动更新弹窗未在本机验证（需要一台低于 0.9.21 的客户端）；`latest.json` 与接口版本已核对。
- 应用商店/PDA 真机安装未验证。
