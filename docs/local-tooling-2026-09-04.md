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

### 2026-09-06 顺丰控制台菜单读取异常

原生 Chrome 控制在点击顶部业务中心导航后，曾仅返回两项浮动菜单，正文和截图缺失；重复点击、Escape、菜单 Cancel 及重连当时均无效，直接获取现有浏览器标签页也出现 30 秒超时。下一轮重新通过 CUA 获取 Chrome 应用时已返回完整开发者页面，随后截图、导航至创建表单、填写输入框、签名单选和语言下拉选择都成功。证据仅支持当前原生控制已恢复，不能据此断言缓存机制、网站故障或底层问题已经永久修复。

随后关联 API 表单中问题复发。访达正常；Chrome 新窗口虽实际打开，原生 AX 仍返回旧顺丰菜单，表明窗口状态读取异常。扩展枚举、创建和关闭标签正常，截图、DOM 与 goto 超时。官方 check-extension-installed.js 与 check-native-host-manifest.js 诊断均退出 0：Default profile 扩展安装、注册、启用及 native-host 配置正确。通过 CUA 在地址栏使用 Chrome 自身的重启入口后，浏览器实例和标签 ID 更新，原 5 个业务标签恢复，顺丰登录保留；本地 ERP 标签转到登录页。原生首页短暂恢复，但重新进入控制台再次仅返回旧菜单，新的扩展连接 DOM 读取也超时，不能报告为彻底修复。

当时达到当前连接能完成的诊断边界，随后请用户重启 Codex 后再验证，以重建宿主连接；这是 [OpenAI 官方浏览器故障排查](https://learn.chatgpt.com/zh-Hans/docs/chrome-extension) 列出的恢复步骤之一。不要继续反复点击旧菜单或创建更多诊断标签；若重启宿主仍失败，再按官方流程检查版本及反馈。临时恢复标签、新窗口和访达窗口已关闭，未批量终止进程、修改安全权限或安装/改写电脑插件。已检查 AGENTS.md；本次是现有工具的故障记录和操作恢复，不改变项目配置或权限规则，无需调整其正文。

后续用户明确授权 AppleScript 仅用于激活 Chrome 和收起菜单。activate 及设置前台成功，但 System Events 按键返回 1002（osascript 不允许发送按键），未更改辅助功能权限。CUA 一度恢复，关联弹窗首次勾选会重建大部分控件索引，必须逐步重新读取；分页后旧菜单问题仍复发，重新激活、窗口恢复及 CUA Escape 未解除。用户再次重启后完整窗口读取恢复，17:39 完成经确认的新滑块与短信登录，企业控制台可读；点击开发者对接后菜单异常再次复发，现有标签的 CUA 连接 20 秒超时，单独 AppleScript 激活未恢复。当前暂请用户手动收起菜单；重启与 AppleScript 激活都只有局部恢复证据，不能称为最终修复。

### 2026-09-06 独立 Chrome DevTools 工具

用户明确允许安装其他工具后，从 npm 官方包安装 `chrome-devtools-mcp@1.8.0` 到 `~/.local/share/flowcube-browser-tools`，包声明的仓库为 `https://github.com/ChromeDevTools/chrome-devtools-mcp`。保留本地 `package-lock.json`，未修改项目依赖或 Codex MCP 配置。其 `chrome-devtools` CLI 可在本任务直接调用；官方目前将该 CLI 标注为实验性。启动时关闭使用统计及 CrUX 查询，使用任务专属十六进制/UUID `--sessionId`，不要使用全局默认会话或重启其他任务的 daemon。

此次使用独立临时浏览器实测：顺丰公开首页加载、`list_pages`、完整 `take_snapshot` 和关闭新手弹窗均成功。随后 `stop`，`status` 明确返回 daemon 未运行。本机 Chrome 为 152.0.7977.76。用户确认本次调试访问后，已通过 Chrome 原生设置开启 `chrome://inspect/#remote-debugging`，并接受本次连接提示，服务监听回环地址 127.0.0.1:9222。独立 CLI 成功复用现有顺丰登录，读取已认证企业用户及既有应用，进入 API 列表、打开关联弹窗、翻页和切换分类均成功，已绕过本次 CUA 菜单读取阻塞；这不代表原电脑插件故障已修复。页面原生 checkbox 输入不能由通用 click 命中，改用已核对的表格行与 input DOM click 后，快照明确显示 checked；下拉菜单可能被 modal 的 AX 范围排除，可用截图及可见 DOM 列表核对。切换接口大类会清空未提交勾选，应分组关联。用户确认后，已成功关联速运四项与基础通用 PDF 面单接口，并保存同步 PDF 模板配置，平台均显示测试中；应用详情显示 0/5。CLI 连续跨页面、分类、分页、表单保存和结果核对均正常。首次等待用户期间已 stop，status 确认 daemon 未运行，并关闭调试复选框及本次设置标签；随后沿用同一授权用途恢复连接。用户随后确认并通过沙箱提交 CAPTCHA，页面显示验证成功，但跳转至顺丰企业账户登录页，未取得 API 结果。恢复短信登录又弹出独立登录拼图，用户确认后已通过并发送短信，已输入本次验证码并点击登录；随后电脑工具报告 Mac 锁定且无法自动解锁，要求用户手动解锁，用户手动解锁后已确认登录恢复。不通过其他工具绕过锁屏限制；测试明细和统计均为 0 条，应用 0/5。沿用本任务已授权的远程调试连接，通过独立 CLI 填好原订单结果查询沙箱表单，提交后出现新拼图；用户确认后原生电脑工具成功完成验证，取得 A1000/业务 6150 找不到该订单的查询回执。随后原生菜单切换下订单接口并填好新的沙箱测试请求，用户确认并通过下单拼图后，取得 A1000/S0000 沙箱成功回执；原生 AX 将长结果截断，沿用已授权调试连接读取 DOM 完整回执，确认 2 件对应 1 母单加 1 子单。用户确认并通过该成功订单的查询拼图后，query 取得独立 A1000/S0000 成功回执，母子单一致。切换 API 时原生工具再次滞留菜单；重建 CUA 会话后，对已观察到的根容器执行 Cancel 恢复正文。typeText 在地址栏输入 chrome:// 时曾漏掉冒号，改用 setValue 修正；这是输入问题，不是网络或平台错误。随后恢复已授权 CLI，核对官方 PDF 文档及接口模板详情，提交两页 100×150 合并 PDF 沙箱请求，用户确认并通过面单拼图后，PDF 返回成功；通过 CLI 只读 DOM 提取下载地址和 Token，经管道交给下载器，下载 Token 不落盘、不回显。两页 PDF 已用 pypdf 和 Poppler 检查尺寸、文本和渲染。此后已无待处理网页拼图，改用官方 HTTPS 沙箱服务及本地适配器执行真实程序联调：下单/查询、轨迹、PDF、取消均成功，所有测试订单均已确认取消；未自动解答未确认的新拼图，未改变鉴权或访问控制。此直接 API 路径同时验证真实代码能力，不能替代正式月结或 ERP 队列验收。平台已将原单查询更新为“待上线”；用户随后已当场确认开通此正式接口并继续绑定，授权已具备。收尾时 CUA 又只返回旧导航菜单，Cancel、重建会话及键盘操作未恢复；原生截图不可用，使用本机 screencapture 只读截图确认 Chrome 实际停在远程调试连接提示，未改变系统权限。重启同一专属 daemon 恢复连接时，该提示无法由失效 CUA 点击，已请用户手动点击当前“允许”。用户随后手动点击当前“允许”，独立 CLI 恢复连接，已完成正式原单查询上线及月结绑定；平台分别返回“已上线”和绑定“成功”。其余四项达到“待上线”后，用户已合并确认新增正式访问权限；独立 CLI 逐项提交上线，全部返回成功，应用最终显示“已上线”、5/5，月结绑定仍为“成功”。本轮最终收尾已关闭远程调试：CLI 点击复选框后连接随即断开，虽然点击工具返回等待超时，但激活 Chrome 后的原生截图确认复选框未勾选；随后 stop 专属 daemon，status 明确确认未运行，并关闭本次设置标签，保留用户的两个顺丰标签。“免面单审核”仅查看表单并取消，未提交不存在的接口人信息。等待期间已重新遮蔽应用详情中的沙箱凭据、stop 专属 daemon，status 确认未运行；远程调试复选框恢复为 0 并关闭本次设置标签，保留查询验证页面。沙箱凭据仅在同源窗口的表单间传递，不输出或落盘。正式月结要求任一接口上线后绑定，本次已满足并取得绑定成功回执。本轮等待新 CAPTCHA 确认前，已关闭本次创建的应用详情标签、stop 专属 daemon 并用 status 确认未运行，调试复选框恢复为 0、设置标签关闭；保留用户顺丰测试页。

```bash
source "$HOME/.config/flowcube/dev-env.sh"
export CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1
export CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1
FLOWCUBE_CHROME_CLI="$HOME/.local/share/flowcube-browser-tools/node_modules/.bin/chrome-devtools"
# 为每个任务指定独立 UUID；不要复用其他正在运行任务的 ID。
FLOWCUBE_CHROME_SESSION="$(uuidgen)"
"$FLOWCUBE_CHROME_CLI" start --sessionId="$FLOWCUBE_CHROME_SESSION" --isolated --headless --no-usage-statistics --no-performance-crux
"$FLOWCUBE_CHROME_CLI" list_pages --sessionId="$FLOWCUBE_CHROME_SESSION"
"$FLOWCUBE_CHROME_CLI" stop --sessionId="$FLOWCUBE_CHROME_SESSION"
"$FLOWCUBE_CHROME_CLI" status --sessionId="$FLOWCUBE_CHROME_SESSION"
```

`--autoConnect` 可在得到调试访问确认后连接当前 Chrome；此步骤与独立临时浏览器测试分开。官方参考：[项目与权限说明](https://github.com/ChromeDevTools/chrome-devtools-mcp)、[CLI](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)、[连接现有 Chrome](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)。AGENTS.md 已同步新工具和资源收尾规则。
