# 极序 Flow 发布与桌面打包规范

## 原则

- **GitHub `main` 分支为唯一事实源**；未推送的本地提交不得作为正式发布构建依据。
- 桌面包构建前会执行 `scripts/git-sync-check.sh`（见 `desktop/package.json` 的 `prebuild`）。

## CI：推送 tag 后自动构建 Windows EXE 并发 GitHub Release

工作流：`.github/workflows/build-desktop.yml`（**Build Desktop Installer**）。

- 触发：`push` 到 `v*` **tag**（推荐发版路径）、或 `push` 到 `main`（验证构建）、或 Actions 里手动运行。手动发布必须使用工作流的发布参数，输入版本匹配实际检出 package；关联 tag 时还须核对其 SHA。
- Runner：`windows-latest`。
- 步骤概要：`npm ci`（frontend → desktop）→ `npm run build`（frontend，桌面包）→ 固定下载 **NSIS 3.0.4.1** → `dist:win`（electron-builder NSIS）→ 校验产物内部为 **`Nullsoft Install System v3.04`** → 将 `desktop/release/*.exe` 上传 **GitHub Release**（**仅 tag 推送**）→ 通过服务器 `scripts/release-desktop.js` 发布到 canonical 下载目录。
- 权限：`contents: write`（`GITHUB_TOKEN` 创建 Release）、`actions: read`（读取待发布实际 SHA 的 Tests 与 Security Scan 结果）。
- Tag 推送时 CI 会校验：**`Git tag` 去掉 `v` 后**必须与 **`desktop/package.json` 的 `version`** 一致，否则失败（避免 exe / Release / 仓库版本错乱）。

发版请严格使用下面「推荐发布流程」，执行 `npm run release:tag-desktop` 推送 tag 后即可在仓库 **Releases** 下载安装包；服务器 canonical 发布目录中的正式文件名统一为 `FlowCube-Setup-<version>.exe`。

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

## Browser 自动部署（main 推送后浏览器直接看到新版本）

工作流：`.github/workflows/deploy-browser.yml`（**Deploy Browser App**）。

- 触发：`push` 到 `main`，或手动 `workflow_dispatch`
- 前置门禁：等待实际待发布 SHA 的 Tests 与 Security Scan 全部成功，失败、取消或超时均不部署。
- 目标：服务器获得部署锁后同步至该 SHA，再执行 `scripts/server-update.sh`；不得跳过发布门禁。
- 结果：GitHub runner 构建 SHA 标记的镜像，通过 SSH 传输并核验归档摘要和镜像 revision；生产保存运行中镜像，只加载 CI 产物，等待 MySQL 健康并执行迁移，再切换应用并验证接口、页面和公网入口；失败恢复旧应用镜像，数据库 DDL 不回滚。
- PDA 首次迁移时先保存旧 APK 的已发布清单；新 APK 经独立构建校验、同 SHA 浏览器部署成功后，才由 `scripts/publish-pda.sh` 原子发布。

### 需要的 Actions 配置

- Secrets
  - `SSH_PRIVATE_KEY`
  - `SMOKE_USERNAME`、`SMOKE_PASSWORD`（服务器页面与对账回跳门禁账号）

说明：

- 本地服务器配置由不入 Git 的 `deploy/production.local.json` 提供；CI 使用工作流声明的 `VITE_ERP_PRODUCTION_ORIGIN` 和 `FLOWCUBE_SERVER_*` Variables。
- 如果缺少 `SSH_PRIVATE_KEY`，浏览器自动部署不会生效；此时即使 `main` 已更新，线上页面也仍会停在旧版本
- 建议同时阅读 [docs/DEPLOY.md](/Users/chengjianghao/flowcube/docs/DEPLOY.md)，后续统一从 `npm run release:prod` 发版

## 推荐发布流程（须按顺序）

以下以仓库克隆在 `~/flowcube` 为例，将 `origin` 换成你的远端即可。

1. 进入项目根目录：`cd ~/flowcube`
2. 同步主分支：`git pull origin main`
3. 先编写 `docs/release-notes/<version>.md`，再同步三端 package/lock 和 PDA 版本（同版本重跑不重复增加 versionCode）：
   ```bash
   bash .agents/skills/release-flowcube/scripts/bump-version.sh <version>
   ```
4. 提交并推送：
   ```bash
   # 根据已核对的提交范围，用 git add -- 逐路径暂存；不要夹带不明旧改动。
   git diff --cached --stat
   git diff --cached --check
   git commit -m "release: bump version"
   git push origin main
   ```
5. 打 tag 并推送（会触发正式构建与 Release；脚本会校验 `main`、工作区干净、远程是否已有同名 tag）：
   ```bash
   npm run release:tag-desktop
   ```

已完成版本同步、更新说明和本地验证，并将所有待发布改动提交到 main 后，可运行 `npm run release:prod` 一次完成推送 main 与新 tag。脚本返回仅代表提交发布请求；还须等待对应 SHA 的检查、浏览器部署及桌面/PDA 发布成功，核对线上健康版本、`/latest.json`、`/api/app-update/latest` 和 `/api/pda/version`。

## 获取 EXE

打开本仓库的 GitHub **Releases** 页面（URL 形如 `https://github.com/<你的用户或组织>/<仓库名>/releases`），进入对应版本（例如 `v0.3.64`），在 **Assets** 中下载 NSIS 安装包。服务器发布目录中的安装包由 `scripts/release-desktop.js` 规范化为 `FlowCube-Setup-<version>.exe`。

## 验证（必做）

在 Windows 安装并启动 exe 后，查看进程日志或开发工具控制台中的：

`🔥 BUILD VERSION: x.x.x`

该版本来自 Electron `app.getVersion()`，与 **`desktop/package.json` / Git tag** 一致即表示本次构建版本正确。

## 异常处理

若 Release 里没有 EXE 或版本不对：

1. 打开 GitHub **Actions**，进入 **Build Desktop Installer** 对应运行记录。
2. 确认该次运行状态为 **success**；若为失败，展开 **Build desktop installer**（`npm run dist:win`）与 **electron-builder** 日志排查。
3. 确认本次发版是 **推送 tag** 触发的运行（仅 `main` 推送不会上传 Release，但会保留 workflow artifact 供排错）。

## 本地跳过检查（仅应急）

```bash
SKIP_GIT_SYNC_CHECK=1 npm run dist:win --prefix desktop
```

不推荐用于正式发布。

## 本机标签 RAW（ZPL）

v0.3.94 起系统已取消 ZPL/TSPL 双指令集并行，统一使用 **ZPL**（`printers` 表历史遗留的 `tspl_*`/`label_raw_format` 字段已随迁移 088/102 清理）。桌面端 `printZpl` 会校验内容含 `^XA`…`^XZ`，非 ZPL 内容直接拒绝并报错，不再有 TSPL 分支或相关环境变量。

**说明**：队列中「FlowCube **RAW**」仅表示本软件提交的假脱机作业，**不是** ZPL 协议名；该显示名属于历史保留，不影响当前极序 Flow 打印链路。

**测试页能打、极序 Flow 不打**：多属 **RAW 指令** 问题（例如打印机固件不接受该内容或驱动未开启 RAW 直通）；可重启 **Print Spooler**、清空队列后更新后端与本机桌面端再试。
