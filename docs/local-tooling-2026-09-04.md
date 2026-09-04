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
| 本地数据库 | 沿用 backend/.env 的本机连接完成只读查询，实际 MySQL 9.6.0；未读取业务数据 |
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

该文件将 Node 22、已安装的 Java 21 和 `$HOME/Android/Sdk` 工具加入当前 shell 环境。它不修改 `.zshrc`、`.zprofile`，也不存储任何凭据。新终端或新的命令执行环境需要重新 source。

工具核查阶段运行前端 `tsc -p frontend/tsconfig.app.json --noEmit`，退出码 0；权限一致性检查 181/181 通过。随后整体系统扫描在隔离 MySQL 8 完成业务回归和 ERP/PDA 前端构建，见 `docs/system-audit-2026-09-04.md`；未在本机构建原生 APK。

### MCP 启动路径

`$HOME/.codex/config.toml` 中旧 `computer-use` 指向当前工作目录下不存在的 `./Codex Computer Use.app/...`。本次仅将 command 修正为应用实际附带的绝对路径：

```text
/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient
```

其余 MCP 配置、凭据、权限设置保持原值。应用升级或更换安装位置后应重新检查此路径。已配置不等于本会话已重新加载；本次独立初始化测试通过，当前 CUA 连接也可用。如其他会话仍报旧路径错误，可在 MCP 设置中重启该服务器。[官方 MCP 配置说明](https://learn.chatgpt.com/zh-Hans/docs/extend/mcp)

GitHub、本地文件/终端、浏览器和电脑控制已有可用能力，本次无需额外安装同用途的 MCP。MySQL 可通过项目 mysql2 客户端操作，不必为了 MCP 形式重复安装数据库服务或复制口令。

### Docker

原环境只有 Docker CLI 和 Compose，没有可用 daemon。本次补装 Colima 0.10.3 / Lima 2.2.0，用独立 `flowcube` profile 准备 Docker 运行环境。Compose 5.5.0 原已安装。

配置为 2 CPU、2 GiB 内存、20 GiB 磁盘容量，不启用 Kubernetes、不自动切换全局 Docker context、不挂载宿主目录。已验证 Docker daemon 29.5.2（Linux arm64）连接成功，拉取并运行 `hello-world` 容器成功，容器自动清理。验证后停止本次空虚拟机，按需启动以节省内存。

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

- 本机 MySQL 9.6 与部署声明的 8.0 存在版本差异。本次没有替换、降级或迁移本机数据库；需要验证 MySQL 8.0 兼容性时使用独立临时容器/测试库。
- 当前 Android SDK 管理器报告 XML 版本警告，但能列出已装 SDK，Gradle 可启动；本次未验证完整 APK 构建、真机连接或相机扫码。构建若受此影响，再更新 command-line tools。
- `.codex/hooks.json` 仍是迁移来的 `PostToolUse` / `EnterWorktree` 配置；本会话没有该工具，不能据此保证创建工作树会自动安装依赖。每个工作树仍需检查依赖。
- 没有安装额外数据库 MCP、第三方文档 MCP 或云浏览器服务；现有能力已覆盖本次检查，无需新增账号或权限。
- 工具可用仅证明基础运行环境可用，不能代替功能验证或生产健康检查。

## 系统修复补充（2026-09-04）

- 增加前端开发依赖 `jsdom` 26.1.0，运行真实组件/HashRouter/更新对话框的 DOM 回归；Node 22 标签镜像复用项目 TypeScript，不再要求 Node 26。
- 发布 PDA 的服务器脚本需要 Python 3（标准库 fcntl/hashlib，无第三方库）；人工服务器部署入口另需 Node 22、GitHub Actions 读取令牌，常规 CI 入口在 runner 完成同 SHA 检查。
- 技能文档校验使用临时 Python venv 安装 PyYAML 6.0.3，未污染系统 Python。尝试安装 actionlint 时 Homebrew 下载、GitHub 下载与 Go 官方代理均超时，未宣称安装成功；本轮使用工作流 YAML 解析、Bash 语法检查和行为回归完成本地验证。

- 修复任务结束后，当前项目已按新 lockfile 重新安装前后端依赖；临时 MySQL 8 容器、口令文件已删除，Colima 已停止。
