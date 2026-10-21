# 极序 Flow 发布与桌面打包规范

## 原则

- **GitHub `main` 分支为唯一事实源**；未推送的本地提交不得作为正式发布构建依据。
- 桌面包构建前会执行 `scripts/git-sync-check.sh`（见 `desktop/package.json` 的 `prebuild`）。

## CI：推送 tag 后自动构建 Windows EXE 并发 GitHub Release

工作流：`.github/workflows/build-desktop.yml`（**Build Desktop Installer**）。

- 触发：`push` 到 `v*` **tag**（推荐发版路径）、或 `push` 到 `main`（验证构建）、或 Actions 里手动运行。手动发布必须使用工作流的发布参数，输入版本匹配实际检出 package；关联 tag 时还须核对其 SHA。
- Runner：`windows-latest`。
- 步骤概要：`npm ci`（frontend → desktop）→ `npm run build`（frontend，桌面包）→ 固定下载 **NSIS 3.0.4.1** → `dist:win`（electron-builder NSIS）→ 校验产物内部为 **`Nullsoft Install System v3.04`** → 将 `desktop/release/*.exe` 上传 **GitHub Release**（**仅 tag 推送**）→ 通过服务器 `scripts/release-desktop.js` 发布到 canonical 下载目录。
- Release 附件上传走 `scripts/publish-release-asset.cjs`（不再用 `gh release upload`）：GitHub 附件存储会间歇性返回 `HTTP 500 Error saving asset`（2026-09-18 v0.9.20 上传多次挂起 15 分钟以上即此原因，gh CLI 不超时、不重试、不校验，中断还会留下没有附件的**草稿** Release）。脚本流程是「确保 Release 存在（缺则建草稿）→ 删同名附件 → 默认 5 次尝试、每次 10 分钟超时、失败 10 秒后重试 → 校验远端附件大小 → 才 `draft=false` + latest」，任何一步失败都以非零退出并打印 `::error::`。补传用同一脚本并传入 `--tag/--version/--file`，文件必须取自服务器 `/versions/v<版本>/` 的 CI 构建包（先复算 sha256 与 `latest.json` 一致）；回归见 `npm run test:release-tooling`。
- 权限：`contents: write`（`GITHUB_TOKEN` 创建 Release）、`actions: read`（读取待发布实际 SHA 的 Tests 与 Security Scan 结果）。
- Tag 推送时 CI 会校验：**`Git tag` 去掉 `v` 后**必须与 **`desktop/package.json` 的 `version`** 一致，否则失败（避免 exe / Release / 仓库版本错乱）。

网页和PDA发布改用下文手动流程；旧本机串联入口已停用。正式发布后可在仓库 **Releases** 下载安装包；服务器 canonical 发布目录中的正式文件名统一为 `FlowCube-Setup-<version>.exe`。0.13.5进入288–292迁移窗口后，缺数量/退货/资金写入契约的0.13.4后端不得自动恢复写入；失败保持停写、核查迁移并向前恢复兼容产物，不能仅凭240契约或可空新列认定安全。

### 桌面安装器约束（本次问题后的固定规则）

- **桌面正式安装包只允许用 GitHub Actions 的 Windows runner 构建**，不要再把本机 Mac 临时产物当正式发布包。
- 工作流里必须固定使用 **官方 `NSIS 3.0.4.1`**，并在构建后校验安装包内部字符串含 **`Nullsoft Install System v3.04`**。
- 根因说明：2026-04-01 已确认，本机打包环境曾被 **Homebrew `makensis 3.11`** 污染，生成的 EXE 在部分 Windows 上会出现“**双击无界面、无反应**”。
- 因此：
  - **允许** 本地做功能开发和调试。
  - **不允许** 用本机随手打出来的桌面 EXE 作为最终上线包。
  - 最终上线包以 **GitHub Release** 和服务器 `/var/www/flowcube-downloads/versions/` 中的同版本文件为准。

## 桌面端发布规范

桌面端更新链只有一个发布目录认知：

```text
/var/www/flowcube-downloads/
  latest.json
  versions/
    v1.0.0/
      FlowCube-Setup-1.0.0.exe
      metadata.json
  current/
    FlowCube-Setup.exe
    version.txt
  quarantine/
```

发布命令：

```bash
node scripts/release-desktop.js x.x.x --artifact=/path/to/FlowCube-Setup-x.x.x.exe
```

规则：

- `latest.json` 是桌面更新的唯一权威入口，对外路径为 `/latest.json`。
- 历史版本统一放在 `/versions/vX.Y.Z/`。
- 当前安装包统一通过 `/current/FlowCube-Setup.exe` 暴露。
- 不允许手工复制安装包到发布目录；必须使用 `scripts/release-desktop.js`，由脚本生成 `metadata.json`、`latest.json` 和 `current/version.txt`。
- `backend/downloads` 已废弃，不再参与构建、部署或更新链。

### `/downloads` 兼容别名退场计划

- `/downloads/` 仅保留给旧桌面客户端或旧 manifest 的 GET/HEAD 静态下载兼容，不是新发布入口。
- 新版本 manifest 禁止生成 `/downloads/...` URL，只允许使用 `/versions/vX.Y.Z/...` 或 `/current/...`。
- `scripts/release-desktop.js` 会拒绝从 `backend/downloads` 发布安装包，并强制 `latest.json` 指向 `/versions/`。
- 计划在 `v0.5.0` 后移除 `/downloads/` alias。移除前置条件：连续 30 天访问日志无 `/downloads/` 命中，且受管客户端均已升级到 `>=0.3.72`。

### 桌面默认 API 地址（避免每次填写服务器）

Electron 使用 `file://` 打开页面时没有浏览器域名，旧逻辑会默认连 `http://localhost:3000`，正式用户必须在登录前改地址。

- 生产默认地址来自 `VITE_ERP_PRODUCTION_ORIGIN`，或 [deploy/production.local.json](/Users/chengjianghao/flowcube/deploy/production.local.json) 的 `erpOrigin`（CI 可用 GitHub Variable `VITE_ERP_PRODUCTION_ORIGIN`）。
- **Build Desktop Installer** 工作流和本地 `desktop` 打包脚本都会强制注入该地址；缺失时直接失败，避免安装包默认连 `localhost:3000`。
- 桌面端连哪个服务器是**打包期焊死**的（见 `docs/换服务器与桌面端自动更新说明.md`）；旧版的登录页改地址 / `Ctrl+Shift+S` 入口已彻底移除。

本地桌面打包示例：`VITE_ERP_PRODUCTION_ORIGIN=https://api.example.com npm run dist:win --prefix desktop`。

## 网页与 PDA 手动发布

执行 [GitHub 手动离线发版](manual-release.md)：运维备份并问老大、老大本人明确批准完整SHA并手动触发、运维检查、QA真浏览器人工验收。合并/push不发布，网页与PDA不串联自动触发。旧Mac入口已停用；不再运行release:prod，也不设置skip gate或自动回滚后门。

桌面Windows构建/tag发布保持独立；main上的桌面job只是验证构建。它不构成网页或PDA批准，也不能替代各自手动运行。桌面变更、旧key清单与停用另外审批，不能为启用新网页/PDA路径自动删除旧key。

## 获取 EXE

打开本仓库的 GitHub **Releases** 页面（URL 形如 `https://github.com/<你的用户或组织>/<仓库名>/releases`），进入对应版本（例如 `v0.3.64`），在 **Assets** 中下载 NSIS 安装包。服务器发布目录中的安装包由 `scripts/release-desktop.js` 规范化为 `FlowCube-Setup-<version>.exe`。

## 验证（必做）

在 Windows 安装并启动 exe 后，查看进程日志或开发工具控制台中的：

`🔥 BUILD VERSION: x.x.x`

该版本来自 Electron `app.getVersion()`，与 **`desktop/package.json` / Git tag** 一致即表示本次构建版本正确。

## 发布工作树收尾

使用独立工作树发版时，完成发布后检查该工作树是否干净，再将其切回本次专用 `codex/release-*` 分支；没有专用分支时可停在已发布提交的 detached HEAD。用 `git worktree list` 确认发布目录不再占用 `main`，避免用户原目录切换时报 `main is already used by worktree`。不要用强制切换或忽略占用的参数绕过 Git 保护。

释放分支占用不等于原目录可以无冲突切换：原目录的未提交和未跟踪文件仍需保留；如果与新 main 重叠，先保存工作并合并差异，不删除文件或强制覆盖。清理工作树本身也要先确认没有需要保留的文件。

## 异常处理

网页/PDA失败立即停止，先由运维核对保留的run/版本收据、实际容器状态及备份；未知结果不重跑，无自动回滚。桌面附件恢复仍按独立原包摘要及Release身份核对，不允许借恢复入口触发网页/PDA。

## 禁止绕过门禁

网页/PDA没有本机应急发版或skip gate入口。失败先核收据，运维按批准备份恢复；不能临时降低audit阈值、自动回滚或重复上传同版本。

## 本机标签 RAW（ZPL）

v0.3.94 起系统已取消 ZPL/TSPL 双指令集并行，统一使用 **ZPL**（`printers` 表历史遗留的 `tspl_*`/`label_raw_format` 字段已随迁移 088/102 清理）。桌面端 `printZpl` 会校验内容含 `^XA`…`^XZ`，非 ZPL 内容直接拒绝并报错，不再有 TSPL 分支或相关环境变量。

**说明**：队列中「FlowCube **RAW**」仅表示本软件提交的假脱机作业，**不是** ZPL 协议名；该显示名属于历史保留，不影响当前极序 Flow 打印链路。

**测试页能打、极序 Flow 不打**：多属 **RAW 指令** 问题（例如打印机固件不接受该内容或驱动未开启 RAW 直通）；可重启 **Print Spooler**、清空队列后更新后端与本机桌面端再试。
