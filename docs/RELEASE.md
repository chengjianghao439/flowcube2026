# FlowCube 发布与桌面打包规范

## 原则

- **GitHub `main` 分支为唯一事实源**；未推送的本地提交不得作为正式发布构建依据。
- 桌面包构建前会执行 `scripts/git-sync-check.sh`（见 `desktop/package.json` 的 `prebuild`）。

## CI：推送 tag 后自动构建 Windows EXE 并发 GitHub Release

工作流：`.github/workflows/build-desktop.yml`（**Build Desktop Installer**）。

- 触发：`push` 到 `v*` **tag**（推荐发版路径）、或 `push` 到 `main`（验证构建）、或 Actions 里 **手动运行**（仅产物/artifact，**不**创建 Release）。
- Runner：`windows-latest`。
- 步骤概要：`npm ci`（frontend → desktop）→ `npm run build`（frontend，桌面包）→ `dist:win`（electron-builder NSIS）→ 将 `desktop/release/*.exe` 上传 **GitHub Release**（**仅 tag 推送**）。
- 权限：`contents: write`（`GITHUB_TOKEN` 创建 Release）。
- Tag 推送时 CI 会校验：**`Git tag` 去掉 `v` 后**必须与 **`desktop/package.json` 的 `version`** 一致，否则失败（避免 exe / Release / 仓库版本错乱）。

发版请严格使用下面「推荐发布流程」，执行 `npm run release:tag-desktop` 推送 tag 后即可在仓库 **Releases** 下载安装包（文件名含 `FlowCube ERP` / `Setup` 等，随 electron-builder 产物而定）。

### 桌面默认 API 地址（避免每次填写服务器）

Electron 使用 `file://` 打开页面时没有浏览器域名，旧逻辑会默认连 `http://localhost:3000`，正式用户必须在登录前改地址。

- 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新增 **`VITE_ERP_PRODUCTION_ORIGIN`**，值为后端根地址，例如 `https://api.example.com`（**不要**带 `/api`）。
- **Build Desktop Installer** 工作流在 `npm run build`（frontend）时已传入该变量；重新打 tag 构建的安装包将登录页**预填**该地址。
- 仍可在登录页「服务器地址」或 **Ctrl+Shift+S** 修改为其它环境。

本地桌面打包示例：`VITE_ERP_PRODUCTION_ORIGIN=https://api.example.com npm run build`（在 `frontend` 目录）。

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

打开本仓库的 GitHub **Releases** 页面（URL 形如 `https://github.com/<你的用户或组织>/<仓库名>/releases`），进入对应版本（例如 `v0.3.2`），在 **Assets** 中下载 NSIS 安装包（名称通常包含 `FlowCube ERP` 与版本号）。

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

**默认不在 TSPL 里插入 `CODEPAGE` 行**（佳博部分固件不认时会整单不执行，而 Windows 仍显示已打印）。**Windows 桌面端**仍将整段脚本按 **GB18030** 编码送 RAW。

- 若固件 **必须** 声明代码页，请在 **打印模板 body** 中自行写 `CODEPAGE …`（并与 `FLOWCUBE_TSPL_BYTES` 一致）。
- 脚本中含 **UTF-8** 类 `CODEPAGE` 时，桌面端自动改送 UTF-8。
- 环境变量 **`FLOWCUBE_TSPL_BYTES=utf8`** 或 **`gb18030`** 可强制字节编码。
- 仍含 `CODEPAGE` 且不出纸时，可试 **`FLOWCUBE_TSPL_OMIT_CODEPAGE=1`** 去掉所有 `CODEPAGE` 行。

**说明**：队列中「FlowCube **RAW**」仅表示本软件提交的假脱机作业，**不是** ZPL 协议名。

**测试页能打、FlowCube 不打**：多属 **RAW 指令/编码** 问题；可重启 **Print Spooler**、清空队列后更新后端与本机桌面端再试。
