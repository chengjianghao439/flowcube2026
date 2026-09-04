# 本地开发工具与 MCP 核查

核查日期：2026-09-04。范围为当前 Mac 的本地开发环境与现有 MCP 连接，不涉及生产部署。以下版本和检查结果为当日快照。

## 已验证的能力

| 项目 | 结果 |
|---|---|
| backend / frontend / desktop 依赖 | 三端 `npm ls --depth=0 --json` 均无缺项或无效依赖 |
| Git / GitHub CLI | Git 可用，gh 已登录；没有修改授权范围 |
| GitHub 插件 | 成功读取当前账号及 flowcube2026 仓库元数据 |
| GitHub 远程 MCP | 使用现有配置完成 initialize，HTTP 200 |
| 电脑控制 MCP | 纠正旧相对路径后，实际二进制完成 initialize |
| 当前 CUA 工具 | 成功读取可用应用与内置浏览器清单 |
| agent-browser | 0.28.0；doctor 6 pass / 0 warn / 0 fail；独立会话打开、读取并关闭 about:blank 成功 |
| Playwright CLI | 项目使用的 npm exec 入口可用，版本 0.1.19；无需额外全局安装 |
| Java / Android | Java 21.0.12.1、adb 37.0.0、Android platform 35 已安装；SDK 管理器列举成功；Gradle 8.11.1 在 Java 21 下可启动 |
| 本地数据库 | 初次核查为 MySQL 9.6.0；后续已迁移开发数据并切换至 MySQL 8.0.46 / 3307，原库保留回退 |
| 文本及辅助工具 | rg、Python、uv、Homebrew 可用 |

## 本次补齐与修复

### 项目专用运行时

项目 Dockerfile 与 CI 使用 Node 22，本机原默认 Node 为 26.8.1。本次通过 Homebrew 并存安装 Node 22.23.2，没有覆盖全局 Node。

创建本机文件 `$HOME/.config/flowcube/dev-env.sh`，供当前项目的终端按需加载：

```bash
source "$HOME/.config/flowcube/dev-env.sh"
node --version
java -version
adb version
```

该文件将 Node 22、已安装的 Java 21 和 `$HOME/Android/Sdk` 工具加入当前 shell 环境。它不修改 `.zshrc`、`.zprofile`，也不存储任何凭据。新终端直接运行底层命令前需要重新 source；本日晚间新增的根目录 `dev:*` 命令会自动加载该文件并验证 Node 22，见操作教程。

工具核查阶段运行前端 `tsc -p frontend/tsconfig.app.json --noEmit`，退出码 0；权限一致性检查 181/181 通过。随后整体系统扫描在隔离 MySQL 8 完成业务回归和 ERP/PDA 前端构建，见 `docs/system-audit-2026-09-04.md`；未在本机构建原生 APK。

### MCP 启动路径

`$HOME/.codex/config.toml` 中旧 `computer-use` 指向当前工作目录下不存在的 `./Codex Computer Use.app/...`。本次仅将 command 修正为应用实际附带的绝对路径：

```text
/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient
```

此次路径修复未修改其他 MCP 的授权范围。应用升级或更换安装位置后应重新检查此路径。已配置不等于本会话已重新加载；独立初始化测试通过，当前 CUA 连接也可用。晚间配置整理另将 GitHub 静态认证头移入个人私有文件，经 `http_headers_helper` 读取，沿用原凭据且初始化 HTTP 200；任务结束后重启应用加载配置。[官方 MCP 配置说明](https://learn.chatgpt.com/zh-Hans/docs/extend/mcp)

GitHub、本地文件/终端、浏览器和电脑控制已有可用能力，本次无需额外安装同用途的 MCP。MySQL 可通过项目 mysql2 客户端操作，不必为了 MCP 形式重复安装数据库服务或复制口令。

### Docker

原环境只有 Docker CLI 和 Compose，没有可用 daemon。本次补装 Colima 0.10.3 / Lima 2.2.0，用独立 `flowcube` profile 准备 Docker 运行环境。Compose 5.5.0 原已安装。

配置为 2 CPU、2 GiB 内存、20 GiB 磁盘容量，不启用 Kubernetes、不自动切换全局 Docker context、不挂载宿主目录。已验证 Docker daemon 29.5.2（Linux arm64）连接成功，拉取并运行 `hello-world` 容器成功，容器自动清理。初次核查后曾停止空虚拟机；晚间已重新启动，当前运行独立开发用 MySQL 8。补装官方 Homebrew Docker Buildx 0.37.0，并实际导出构建上下文验证根 `.dockerignore`。

```bash
colima start flowcube --activate=false
docker --context colima-flowcube info
docker --context colima-flowcube compose version
# 使用完毕且无需要保留运行的服务时：
colima stop flowcube
```

这里显式指定 Docker context；直接运行不带 context 的 docker 命令仍沿用用户原来的默认设置。当前 profile 不共享宿主目录，后续需要 bind mount 开发目录时应只添加所需目录的挂载。

## 使用边界

整体扫描补充（2026-09-04）：通过 Homebrew 安装 Gitleaks 8.30.1，按仓库配置对当前提交导出的文件扫描，0 条发现；不含完整历史或真实环境文件。使用上述 Colima profile 运行一次性 MySQL 8.0.46 完成隔离测试，结束后已删除临时容器并停止虚拟机，未改动本机 MySQL 9.6。扫描阶段三端 npm audit 超时；随后修复任务重新扫描成功，升级相关依赖后，三端 `--omit=dev` 审计均为零，详见 `docs/system-audit-fixes-2026-09-04.md`。

- 晚间后续按用户授权将本地开发后端从 MySQL 9.6 切换至 MySQL 8.0.46 / 3307 / flowcube_dev8，134 张表、215,843 行完整迁入，233 条迁移记录保留（全部 232 份 SQL 已执行）。原 9.6 数据目录和服务保留，没有原地降级。破坏性回归仍使用单独测试库，不能直接对开发业务库运行。详见 [迁移记录](local-mysql8-cutover-2026-09-04.md)。
- 当前 Android SDK 管理器报告 XML 版本警告，但能列出已装 SDK，Gradle 可启动；本次未验证完整 APK 构建、真机连接或相机扫码。构建若受此影响，再更新 command-line tools。
- 旧 `.codex/hooks.json` 的 `PostToolUse` / `EnterWorktree` 配置已移除。新的 `npm run dev:setup` 负责三端依赖准备，用户仍需在 Codex Local environments 的 Setup script 中保存该命令，才能在新工作树创建时自动执行；真实 `.env` 不由脚本复制。
- 没有安装额外数据库 MCP、第三方文档 MCP 或云浏览器服务；现有能力已覆盖本次检查，无需新增账号或权限。
- 工具可用仅证明基础运行环境可用，不能代替功能验证或生产健康检查。

## 系统修复补充（2026-09-04）

- 增加前端开发依赖 `jsdom` 26.1.0，运行真实组件/HashRouter/更新对话框的 DOM 回归；Node 22 标签镜像复用项目 TypeScript，不再要求 Node 26。
- 发布 PDA 的服务器脚本需要 Python 3（标准库 fcntl/hashlib，无第三方库）；人工服务器部署入口另需 Node 22、GitHub Actions 读取令牌，常规 CI 入口在 runner 完成同 SHA 检查。
- 技能文档校验使用临时 Python venv 安装 PyYAML 6.0.3，未污染系统 Python。尝试安装 actionlint 时 Homebrew 下载、GitHub 下载与 Go 官方代理均超时，未宣称安装成功；本轮使用工作流 YAML 解析、Bash 语法检查和行为回归完成本地验证。

- 修复任务结束时，当前项目按新 lockfile 重新安装前后端依赖；审计用临时 MySQL 8 容器、口令文件已删除。晚间本地配置任务另创建了开发用持久容器和私有配置，当前 Colima 正在运行，两个阶段的容器和凭据并不共用。

## Codex 配置落地补充（当日晚间）

新增 Node 22 开发命令、工作树安装脚本、独立 MySQL 8、Docker 构建排除；收窄通用设计技能、停用当前 checkout 的重复设计技能，修正发版技能的重复确认要求。个人 Codex 配置移出 Claude 专用变量并隔离 GitHub MCP 凭据，保留模型、权限范围与其他 MCP。已完成项、尚待用户操作项、备份位置及验证结果统一见 [Codex 本地操作教程](codex-local-setup-2026-09-04.md)。

## Chrome 扩展（当日晚间，已安装并连接）

用户要求自行下载 Chrome 控制扩展，并明确同意扩展权限。正常商店入口跳转“此商品无法购买或下载”，因此从 Google 官方更新服务取得 1.26.827.12125 的 CRX3 包，下载至个人 Downloads/ChatGPT-Chrome-Extension，未放入仓库；现已在 Chrome Default profile 通过“加载已解压的扩展程序”安装并启用。

已核验 CRX3 发布者签名，签名公钥推导的扩展 ID 与应用配置的 `hehggadaopoacecdllhhajmbjkdcmajg` 一致。原始文件 SHA-256：`9d2d461ad78f3ae576d7a15ad1fb3957d5de0fe63901836a727b1f1522b4dd64`。本地导入目录保留全部应用代码，仅增加由已验证公钥生成的 manifest.key 以保持扩展 ID，略去 Chrome 自动生成的 _metadata；校验说明在同目录 verification.json。

安装使用目录 `~/Downloads/ChatGPT-Chrome-Extension/unpacked-1.26.827.12125`，须保留该目录。Chrome 开发者模式已开启；扩展按用户本次授权取得其声明的网页、调试、历史、书签、下载、本地应用通信等权限。没有更改企业策略或安全检查。此安装方式不保证自动更新，后续更新应重新取得官方包并核验，不能以当前版本永久保持最新。

配套桌面插件 26.901.31953 已通过官方 `codex plugin add chrome@openai-bundled --json` 安装。安装扩展后，应用自动注册 native-host；官方诊断确认扩展 installed/registered/enabled 均为 true，native-host exists/correct 均为 true，两个诊断退出码均为 0，未手动创建或修补 manifest。CUA 已通过 extension 类型的 Chrome 连接列出真实标签页，并成功读取阿里云控制台和 VNC 页，证明浏览器通信可用；这不代表服务器已恢复。

随后浏览器扩展控制出现两次 30 秒超时，已切回同一 CUA 的原生 Chrome 界面继续诊断；原生控制可用。首次连接验证已通过，但持续通信稳定性仍待核实，不能宣称所有 MCP 故障已经解决。


### 2026-09-05 发布流程验证工具

按项目长期工具安装授权，通过 Homebrew 官方 formula 补装 actionlint 1.7.12、ShellCheck 0.11.0、GNU coreutils 9.11；用于 Actions/Bash 静态检查与真实 timeout 回归。未信任或安装 Homebrew 提示的其他第三方 tap。macOS 使用 `gtimeout`，生产 Linux 使用 `timeout`。
