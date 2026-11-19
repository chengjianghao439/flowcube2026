# 极序 Flow 发布与桌面打包规范

> **现行发布约束（2026-10-30，用户明确要求）**：发布失败即停止并保留本次 SHA、阶段、迁移状态、备份路径和原镜像身份供人工核查；不自动 tag 旧镜像、不重建或恢复旧容器、不改写 PDA 清单。前置检查失败保持原应用；停写请求开始后失败（含信号、备份、半迁移、应用或页面门禁失败）停止 backend/frontend 并保持停写，核查后向前修复。数据库 DDL 和业务数据不自动回滚。迁移前以固定完整 SHA 的候选镜像、Compose 实际迁移账户运行独立只读 helper（覆盖配置锁定 image/read_only，使用 pull_policy: never 并以 !reset 清除继承 build，兼容 Compose 2.27.0 run 无 --pull 参数，以 node 用户和 node entrypoint 执行，不启动应用或迁移器）。读取候选 SQL 和 db_migrations 求待执行集合；没有待执行触发器/函数时，不因 trust=0 拒绝。有相关待执行 SQL（含动态字符串及 ALTER FUNCTION）时，先核实际迁移数据库的 TRIGGER、CREATE ROUTINE 或 ALTER ROUTINE 权限，再核已有 log_bin=0、trust=1 或迁移账户全局 SUPER/ALL 之一；未知或查询失败在应用标签改变、停写和迁移之前拒绝。显式 DEFINER 身份未证明时拒绝；binlog 开启且 trust 关闭时，无法可靠证明函数声明的 CREATE/ALTER FUNCTION 保守拒绝。发布脚本不执行任何 SET GLOBAL，不修改或恢复数据库全局参数和权限；原 schema 权限与迁移器完整检查继续生效。同 SHA 的镜像、实例归属、全新备份 create/verify、迁移及安全/健康门禁保持。下文历史回退记录不构成当前自动恢复授权。

## 原则

- **GitHub `main` 分支为唯一事实源**；未推送的本地提交不得作为正式发布构建依据。
- 桌面包构建前会执行 `scripts/git-sync-check.sh`（见 `desktop/package.json` 的 `prebuild`）。

## CI：推送 tag 后自动构建 Windows EXE 并发 GitHub Release

工作流：`.github/workflows/build-desktop.yml`（**Build Desktop Installer**）。

- 触发：`push` 到 `v*` **tag**（推荐发版路径）、或 `push` 到 `main`（验证构建）、或 Actions 里手动运行。手动发布必须使用工作流的发布参数，输入版本匹配实际检出 package；关联 tag 时还须核对其 SHA。
- Runner：`windows-latest`。
- 步骤概要：`npm ci`（frontend → desktop）→ `npm run build`（frontend，桌面包）→ 固定下载 **NSIS 3.0.4.1** → `dist:win`（electron-builder NSIS）→ 校验产物内部为 **`Nullsoft Install System v3.04`** → 核对两处已有发布身份 → 上传到 GitHub Release 草稿 → 更新服务器规范下载目录 → 从公开地址回读同一 EXE 后转正草稿。
- Release 附件由 [发布脚本](../scripts/publish-release-asset.cjs)上传和核验。脚本重用同版本同摘要的附件，遇到已上传附件身份或摘要冲突即停止。重试时只移除经核验的草稿零字节占位。脚本默认最多尝试 5 次、单次 10 分钟、失败间隔 10 秒。服务器公开地址和 GitHub 附件均与原构建匹配后，才转正草稿。补发按下文原构建产物恢复流程处理。
- 权限：`contents: write`（`GITHUB_TOKEN` 创建 Release）、`actions: read`（读取待发布实际 SHA 的 Tests 与 Security Scan 结果）。
- Tag 推送时 CI 会校验：**`Git tag` 去掉 `v` 后**必须与 **`desktop/package.json` 的 `version`** 一致，否则失败（避免 exe / Release / 仓库版本错乱）。

发版请严格使用下面「正式发布流程（唯一入口）」；`npm run release:prod` 会依次完成同提交门禁、三端发布和线上核对。正式发布后可在仓库 **Releases** 下载安装包；服务器 canonical 发布目录中的正式文件名统一为 `FlowCube-Setup-<version>.exe`。0.13.5进入288–292迁移窗口后，缺数量/退货/资金写入契约的0.13.4后端不得自动恢复写入；失败保持停写、核查迁移并向前恢复兼容产物，不能仅凭240契约或可空新列认定安全。

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
node scripts/release-desktop.js x.x.x \
  --artifact=/path/to/FlowCube-Setup-x.x.x.exe \
  --source-sha=<原构建完整提交> --sha256=<原构建安装包摘要>
```

规则：

- `latest.json` 是桌面更新的唯一权威入口，对外路径为 `/latest.json`。
- 历史版本统一放在 `/versions/vX.Y.Z/`。
- 当前安装包统一通过 `/current/FlowCube-Setup.exe` 暴露。
- 不允许手工复制安装包到发布目录；必须使用 `scripts/release-desktop.js`，由脚本生成 `metadata.json`、`latest.json` 和 `current/version.txt`。
- `backend/downloads` 已废弃，不再参与构建、部署或更新链。

同一版本以原构建提交和 Windows EXE 的 SHA256 绑定。工作流先只读核对 GitHub tag、同版草稿/附件以及服务器的同版元数据和实际文件。两处均通过才准备草稿附件，再发布服务器文件与 `latest.json`。随后通过可信 HTTPS 实际下载规范路径的 EXE，校验文件与 GitHub 已上传附件的摘要，再转正 Release。已发布同摘要附件重用；同版本异摘要或异提交在公开文件更改前报错。既有旧版本元数据缺提交时，服务器在已核原字节及来源后补录；磁盘保留期只回收已绑定的旧安装包字节，元数据留作身份核对。

发生中断时保留原 run、artifact ID、tag、完整提交和摘要。后端部署完成且同 SHA 检查通过后，在 **Build Desktop Installer** 手动入口填写原 `source_run_id` 和原 `source_artifact_id`，`release_tag` 和 `checkout_ref` 都填同一个原始 tag，并选择发布 GitHub 附件。恢复 job 直接下载原 artifact、校验来源与摘要，复用同一发布步骤。官网已可下载原包且草稿附件齐全时，可用 **Recover Release Asset** 只核线上与转正。原包不可获取时保留现场并停止同版发布。

正式构建、独立 SSH 传输及真实 Windows 安装和更新各自留证。服务器中转须用已验主机键，下载目录里的可公开 EXE 应由运行用户可读。离线合成测试覆盖两处摘要冲突、草稿及服务器中断、响应丢失和字节校验。

### 旧下载地址兼容

- `/downloads/` 仅保留给旧桌面客户端或旧 manifest 的 GET/HEAD 静态下载兼容，不是新发布入口。
- 新版本 manifest 禁止生成 `/downloads/...` URL，只允许使用 `/versions/vX.Y.Z/...` 或 `/current/...`。
- `scripts/release-desktop.js` 会拒绝从 `backend/downloads` 发布安装包，并强制 `latest.json` 指向 `/versions/`。
- 下线条件和审批入口见[部署说明](DEPLOY.md#downloads-兼容别名)。

### 桌面默认 API 地址（避免每次填写服务器）

Electron 使用 `file://` 打开页面时没有浏览器域名，旧逻辑会默认连 `http://localhost:3000`，正式用户必须在登录前改地址。

- 生产默认地址来自 `VITE_ERP_PRODUCTION_ORIGIN`，或 本机部署配置（参照[脱敏示例](../deploy/production.example.json)） 的 `erpOrigin`（CI 可用 GitHub Variable `VITE_ERP_PRODUCTION_ORIGIN`）。
- **Build Desktop Installer** 工作流和本地 `desktop` 打包脚本都会强制注入该地址；缺失时直接失败，避免安装包默认连 `localhost:3000`。
- 桌面端连哪个服务器是**打包期焊死**的（见 `docs/换服务器与桌面端自动更新说明.md`）；旧版的登录页改地址 / `Ctrl+Shift+S` 入口已彻底移除。

本地桌面打包示例：`VITE_ERP_PRODUCTION_ORIGIN=https://api.example.com npm run dist:win --prefix desktop`。

## 网页和 PDA 显式部署

工作流：`.github/workflows/deploy-browser.yml`（**Deploy Browser App**）。

- 合并到 `main` 触发 Tests、Security Scan 和桌面验证构建。网页和 PDA 正式工作流由获授权的发布入口显式触发。
- 网页工作流要求在 `main` 上提交 `checkout_ref`，其值必须是触发时的完整提交 SHA。联合发布时 PDA 同时接收本次网页部署运行编号，并核对同一 SHA。
- 前置门禁：等待实际待发布 SHA 的 Tests 与 Security Scan 全部成功，失败、取消或超时均不部署。
- 目标：服务器获得部署锁后同步至该 SHA，再执行 `scripts/server-update.sh`；不得跳过发布门禁。
- 结果：GitHub runner 构建 SHA 标记的镜像，通过 SSH 传输并核验归档摘要和镜像 revision；生产保存运行中镜像，只加载 CI 产物，等待 MySQL 健康，暂停业务写入并执行迁移，再切换应用并验证接口、页面和公网入口。发布失败即停止并保留本次 SHA、阶段、迁移状态、备份路径和原镜像身份供人工核查；不自动 tag 旧镜像、不重建或恢复旧容器、不改写 PDA 清单。前置检查失败保持原应用；停写请求开始后失败（含信号、备份、半迁移、应用或页面门禁失败）停止 backend/frontend 并保持停写，核查后向前修复。数据库 DDL 和业务数据不自动回滚。
- PDA 首次迁移时先保存旧 APK 的已发布清单；新 APK 经独立构建校验、同 SHA 浏览器部署成功后，才由 `scripts/publish-pda.sh` 原子发布。
- `Build PDA APK` 的前置门核对 `backend/apk/version.json` 和 `build.gradle`，再比对线上 `/api/pda/version`。目标版本号和 versionCode 已发布时，构建跳过并记为成功。更新安装包须先提升版本号。需要单独补发时，沿用 `gh workflow run build-pda-apk.yml --ref main -f checkout_ref=<已部署的完整提交SHA>` 并等待该提交的网页部署记录。

### 需要的 Actions 配置

- Secrets
  - `SSH_PRIVATE_KEY`
  - `SMOKE_USERNAME`、`SMOKE_PASSWORD`（服务器页面与对账回跳门禁账号）
  - `SMOKE_LIMITED_USERNAME`、`SMOKE_LIMITED_PASSWORD`（长期保留的受限权限验收账号，仅仪表盘和收货查看，使用独立随机口令）
  - PDA 正式签名使用 `PDA_SIGNING_KEYSTORE_BASE64`、`PDA_SIGNING_STORE_PASSWORD`、`PDA_SIGNING_KEY_ALIAS`、`PDA_SIGNING_KEY_PASSWORD`。配置和校验以 [Build PDA APK](../.github/workflows/build-pda-apk.yml) 为准。

说明：

- 本地服务器配置由不入 Git 的 `deploy/production.local.json` 提供；CI 使用工作流声明的 `VITE_ERP_PRODUCTION_ORIGIN` 和 `FLOWCUBE_SERVER_*` Variables。
- 三端发布通过 WireGuard 连接生产 SSH。各发布 job 从其受保护的 GitHub 环境读取独立的 `FLOWCUBE_WG_PRIVATE_KEY` 和固定客户端地址，继续使用现有 `SSH_PRIVATE_KEY` 与核实过的 `FLOWCUBE_SSH_KNOWN_HOSTS`。网络或认证异常会中止 SSH 步骤。配置及只读探针见[发布 SSH 与救援](print-deploy-ops.md#发布-ssh-与救援)。

## 正式发布流程（唯一入口）

以下以仓库克隆在 `~/flowcube` 为例，将 `origin` 换成你的远端即可。

1. 进入项目根目录：`cd ~/flowcube`
2. 同步主分支：`git pull --ff-only origin main`
3. 先编写 `docs/release-notes/<version>.md`，再同步三端 package/lock 和 PDA 版本（同版本重跑不重复增加 versionCode）：
   ```bash
   bash .agents/skills/release-flowcube/scripts/bump-version.sh <version>
   ```
4. 提交待发布代码：
   ```bash
   # 根据已核对的提交范围，用 git add -- 逐路径暂存；不要夹带不明旧改动。
   git diff --cached --stat
   git diff --cached --check
   git commit -m "release: bump version"
   ```
5. 通过 PR 将待发布代码合入 `main`，同步本地 `main` 并保持工作区干净。获得正式发布授权后运行：
   ```bash
   npm run release:prod
   ```

`release:prod` 校验本地 HEAD 等于 GitHub 实际 `main`，核可信主机键、代理（`HTTPS_PROXY`）和 `flowcube-prod` SSH 别名。预检通过后显式触发同 SHA 的网页和 PDA 工作流，记录两个运行编号，中转和等待只使用本次编号。触发结果未知时先核对已存在的运行，避免重复触发。主线检查、网页和 PDA 完成后，才推送对应的 Windows tag 并核对线上三端。桌面 tag 前置检查仍要求目标为最新 `main`。如中途主线前移导致该检查失败，保留已完成阶段和原运行记录。运行期间保持中转 Mac 在线，CI 仍可按原边界使用 HTTPS/SCP 故障回退。发布后可重复只读验收：

```bash
npm run release:verify -- --origin https://<生产域名>
```

逐项核对 `/latest.json`、`/api/app-update/latest`、`/api/pda/version`（版本 + versionCode + 可下载）与 `/api/health`，随后实际下载 EXE/APK 并核对 SHA256；**PDA 落后或包摘要不符即视为发版未完成**（v0.9.19 曾出现浏览器/桌面已发布、PDA 停在上一版而无人发现）。PDA 补跑见 `.agents/skills/release-flowcube/SKILL.md` 的「PDA 没跟上时」。

发布收尾检查（必做）：成功发布且健康、版本验收通过后，按 [DEPLOY.md「发布成功后的镜像与磁盘收尾」](DEPLOY.md#发布成功后的镜像与磁盘收尾)完成镜像引用与空间盘点，将保留集合、精确拟清理清单及已处理/待确认/无安全清理对象的结论写入本版发布结果。

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

若 Release 里没有 EXE 或版本不对：

1. 打开 GitHub **Actions**，进入 **Build Desktop Installer** 对应运行记录。
2. 确认该次运行状态为 **success**；若为失败，展开 **Build desktop installer**（`npm run dist:win`）与 **electron-builder** 日志排查。
3. 确认本次发版是 **推送 tag** 触发的运行（仅 `main` 推送不会上传 Release，但会保留 workflow artifact 供排错）。
4. 若失败在 **Upload EXE to Release**：GitHub 附件存储偶发的 `HTTP 500 Error saving asset` 由 `scripts/publish-release-asset.cjs` 自动重试；仍失败时按日志处置，并从服务器 `/versions/v<版本>/` 取回 **CI 构建的同一份 exe**（先复算 sha256 与 `latest.json` 一致）补传：
   ```bash
   node scripts/publish-release-asset.cjs --tag v<版本> --version <版本> --file <exe>
   ```
   该脚本会在附件校验通过后才把 Release 从草稿转正。不要在本机重新构建 exe；**正式包、清单或附件已写入后**不要重跑 tag 构建，重构建可能生成不同字节并使摘要对不上。若 tag 首次运行在这些写入之前就因传输失败，可核对 tag 与原发布 SHA 后重跑同一工作流 attempt，详见发布技能的「传输故障」。

## 本地跳过检查（仅应急）

```bash
SKIP_GIT_SYNC_CHECK=1 npm run dist:win --prefix desktop
```

不推荐用于正式发布。

## 本机标签 RAW（ZPL）

v0.3.94 起系统已取消 ZPL/TSPL 双指令集并行，统一使用 **ZPL**（`printers` 表历史遗留的 `tspl_*`/`label_raw_format` 字段已随迁移 088/102 清理）。桌面端 `printZpl` 会校验内容含 `^XA`…`^XZ`，非 ZPL 内容直接拒绝并报错，不再有 TSPL 分支或相关环境变量。

**说明**：队列中「FlowCube **RAW**」仅表示本软件提交的假脱机作业，**不是** ZPL 协议名；该显示名属于历史保留，不影响当前极序 Flow 打印链路。

**测试页能打、极序 Flow 不打**：多属 **RAW 指令** 问题（例如打印机固件不接受该内容或驱动未开启 RAW 直通）；可重启 **Print Spooler**、清空队列后更新后端与本机桌面端再试。
