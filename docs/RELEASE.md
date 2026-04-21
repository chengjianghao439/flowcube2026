# 极序 Flow 发布与桌面打包规范

## 原则

- **GitHub `main` 分支为唯一事实源**；未推送的本地提交不得作为正式发布构建依据。
- 桌面包构建前会执行 `scripts/git-sync-check.sh`（见 `desktop/package.json` 的 `prebuild`）。

## CI：推送 tag 后自动构建 Windows EXE 并发 GitHub Release

工作流：`.github/workflows/build-desktop.yml`（**Build Desktop Installer**）。

- 触发：`push` 到 `v*` **tag**（推荐发版路径）、或 `push` 到 `main`（验证构建）、或 Actions 里 **手动运行**（仅产物/artifact，**不**创建 Release）。
- Runner：`windows-latest`。
- 步骤概要：`npm ci`（frontend → desktop）→ `npm run build`（frontend，桌面包）→ 固定下载 **NSIS 3.0.4.1** → `dist:win`（electron-builder NSIS）→ 校验产物内部为 **`Nullsoft Install System v3.04`** → 将 `desktop/release/*.exe` 上传 **GitHub Release**（**仅 tag 推送**）。
- 权限：`contents: write`（`GITHUB_TOKEN` 创建 Release）。
- Tag 推送时 CI 会校验：**`Git tag` 去掉 `v` 后**必须与 **`desktop/package.json` 的 `version`** 一致，否则失败（避免 exe / Release / 仓库版本错乱）。

发版请严格使用下面「推荐发布流程」，执行 `npm run release:tag-desktop` 推送 tag 后即可在仓库 **Releases** 下载安装包（当前正式安装包名为 `Jixu-Flow-Setup-<version>.exe`）。

### 桌面安装器约束（本次问题后的固定规则）

- **桌面正式安装包只允许用 GitHub Actions 的 Windows runner 构建**，不要再把本机 Mac 临时产物当正式发布包。
- 工作流里必须固定使用 **官方 `NSIS 3.0.4.1`**，并在构建后校验安装包内部字符串含 **`Nullsoft Install System v3.04`**。
- 根因说明：2026-04-01 已确认，本机打包环境曾被 **Homebrew `makensis 3.11`** 污染，生成的 EXE 在部分 Windows 上会出现“**双击无界面、无反应**”。
- 因此：
  - **允许** 本地做功能开发和调试。
  - **不允许** 用本机随手打出来的桌面 EXE 作为最终上线包。
  - 最终上线包以 **GitHub Release** 和服务器 `/downloads` 中的同版本文件为准。

### 桌面默认 API 地址（避免每次填写服务器）

Electron 使用 `file://` 打开页面时没有浏览器域名，旧逻辑会默认连 `http://localhost:3000`，正式用户必须在登录前改地址。

- 生产默认地址已固定在 [deploy/production.json](/Users/chengjianghao/flowcube/deploy/production.json) 的 `erpOrigin`。
- **Build Desktop Installer** 工作流在 `npm run build`（frontend）时会自动读取该配置；重新打 tag 构建的安装包会把这个地址作为登录页默认值。
- 仍可在登录页「服务器地址」或 **Ctrl+Shift+S** 修改为其它环境。

本地桌面打包示例：`VITE_ERP_PRODUCTION_ORIGIN=https://api.example.com npm run build`（在 `frontend` 目录）。

## Browser 自动部署（main 推送后浏览器直接看到新版本）

工作流：`.github/workflows/deploy-browser.yml`（**Deploy Browser App**）。

- 触发：`push` 到 `main`，或手动 `workflow_dispatch`
- 目标：在服务器仓库根目录执行 `SKIP_RELEASE_GATE=1 bash scripts/server-update.sh`
- 结果：自动 `git pull origin main`，并重建 `backend` / `frontend` 容器，浏览器直接拿到本次提交的前端静态资源

### 需要的 Actions 配置

- Secrets
  - `SSH_PRIVATE_KEY`

说明：

- 服务器 host / user / path、浏览器 origin 已固定在 [deploy/production.json](/Users/chengjianghao/flowcube/deploy/production.json)
- 如果缺少 `SSH_PRIVATE_KEY`，浏览器自动部署不会生效；此时即使 `main` 已更新，线上页面也仍会停在旧版本
- 建议同时阅读 [docs/DEPLOY.md](/Users/chengjianghao/flowcube/docs/DEPLOY.md)，后续统一从 `npm run release:prod` 发版

## 推荐发布流程（须按顺序）

以下以仓库克隆在 `~/flowcube` 为例，将 `origin` 换成你的远端即可。

1. 进入项目根目录：`cd ~/flowcube`
2. 同步主分支：`git pull origin main`
3. 更新版本号（关键）：
   ```bash
   cd desktop && npm version patch --no-git-tag-version && cd ..
   ```
4. 提交并推送：
   ```bash
   git add .
   git commit -m "release: bump version"
   git push origin main
   ```
5. 打 tag 并推送（会触发正式构建与 Release；脚本会校验 `main`、工作区干净、远程是否已有同名 tag）：
   ```bash
   npm run release:tag-desktop
   ```

等价合并（在已对齐 `main` 且已提交所有改动前提下）：也可先 `cd desktop && npm version patch --no-git-tag-version`，再在根目录 `git add desktop/package.json desktop/package-lock.json && git commit -m "chore(desktop): bump version" && git push origin main`，最后 `npm run release:tag-desktop`。

## 获取 EXE

打开本仓库的 GitHub **Releases** 页面（URL 形如 `https://github.com/<你的用户或组织>/<仓库名>/releases`），进入对应版本（例如 `v0.3.64`），在 **Assets** 中下载 NSIS 安装包（当前正式命名通常为 `Jixu-Flow-Setup-<version>.exe`）。

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

## 本机标签 RAW（TSPL）换行

若某台 TSC/佳博在 **默认（保持模板原始换行）** 下不出纸，可仅为该电脑设置环境变量 **`FLOWCUBE_TSPL_CRLF=1`** 后重启 FlowCube 桌面端，再试打印；多数机型不需要此项。

若 **强制 CRLF** 后反而从「能印」变成「不印」，请 **去掉** 该变量或设为 `0`。

## 本机 TSPL 中文编码（佳博 / TSC）

**默认不在 TSPL 里插入 `CODEPAGE` 行**（佳博部分固件不认时会整单不执行，而 Windows 仍显示已打印）。**Windows 桌面端**对 TSPL 默认按 **UTF-8** 送 RAW；脚本含 **`CODEPAGE 936`**（或 **86**）或设置 **`FLOWCUBE_TSPL_BYTES=gb18030`** 时改为 **GB18030**。

- 若固件 **必须** 声明代码页，请在 **打印模板 body** 中自行写 `CODEPAGE …`（并与 `FLOWCUBE_TSPL_BYTES` 一致）。
- 脚本中含 **UTF-8** 类 `CODEPAGE` 时，桌面端自动改送 UTF-8。
- 环境变量 **`FLOWCUBE_TSPL_BYTES=utf8`** 或 **`gb18030`** 可强制字节编码。
- 仍含 `CODEPAGE` 且不出纸时，可试 **`FLOWCUBE_TSPL_OMIT_CODEPAGE=1`** 去掉所有 `CODEPAGE` 行。

**说明**：队列中「FlowCube **RAW**」仅表示本软件提交的假脱机作业，**不是** ZPL 协议名；该显示名属于历史保留，不影响当前极序 Flow 打印链路。

**测试页能打、极序 Flow 不打**：多属 **RAW 指令/编码** 问题；可重启 **Print Spooler**、清空队列后更新后端与本机桌面端再试。
