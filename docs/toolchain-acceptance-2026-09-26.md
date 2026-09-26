# 开发工具链配置与验收（2026-09-26）

> 目的：为极序 Flow 建立真正可用的「开发 / 审查 / 验收」工具环境，并逐项实测。
> 本轮是**工具能力验收**，不是业务验收；不做业务代码修改、不做系统重构、不部署生产。
> 基线：`main` @ `b818a08`，工作区含既有未提交改动（未触碰）。

---

## 0. 运行环境（先确认命令到底在哪里执行）

| 项 | 实际值 | 判定方式 |
|---|---|---|
| 客户端 | Claude 桌面端 Code 会话；内嵌 Claude Code CLI **2.1.281** | 进程路径 `…/Claude-3p/claude-code/2.1.281/claude.app/…/claude` |
| 执行位置 | **本机 Mac**（macOS 27.0、arm64、用户 `chengjianghao`），非容器/虚拟机/远程主机 | `sw_vers`、`uname -m`、`whoami` 与进程路径一致 |
| 运行时 | Node **26.8.1**、npm 11.19.0（项目要求 Node 22，本机偏高） | `node -v` |
| 模型提供方 | 由 host 托管（`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`），`ANTHROPIC_BASE_URL` 指向既有自定义网关 | 环境变量名核对；**本轮未改动任何网关/密钥/模型设置** |
| 配置作用域 | 用户级 `~/.claude`、`~/.claude.json`；项目级 `~/flowcube/.claude` | 逐文件核对 |

**重要边界**：内嵌 CLI 独立运行时**无法认证**（`Not logged in`）——认证由桌面 app 托管，不接受外部 CLI 复用。因此「用 CLI 跑一次真实模型调用」这条路在本机不通；插件/技能的最终生效只能在**桌面 app 的新会话**中确认。

---

## 1. 能力清单与验收结果

状态取值：**已有且验证通过** / **新安装且验证通过** / **已安装待加载** / **待授权** / **环境不支持** / **调用失败** / **重复或无必要未安装**。

### 1.1 代码导航（TypeScript LSP）— 新安装，依赖已验证通过

| 项 | 值 |
|---|---|
| 工具/来源 | `typescript-lsp@claude-plugins-official` v1.0.0（Anthropic 官方市场） + `typescript-language-server` 6.0.1 |
| 作用域 | user |
| 配置位置 | `~/.claude/settings.json` → `enabledPlugins`；服务器依赖在 `/opt/homebrew/bin` |
| 实际验证 | 以 LSP 协议直连实测：在 `frontend/src/lib/dateTime.ts` 对真实函数 `formatDisplayDateTime` 查引用 → **129 处 / 57 个文件**；从消费方 `DocumentActivityPanel.tsx` 的使用处请求定义 → **准确跳转到 `dateTime.ts:57`** |
| 关键结论 | 日志显示 `Using Typescript version (workspace) 5.9.3 from frontend/node_modules/typescript` —— **自动采用项目工作区版本**，未升级或改动项目依赖 |
| 待办 | 插件本体需新会话加载后才在会话内提供 LSP 能力 |
| 卸载 | `claude plugin uninstall typescript-lsp@claude-plugins-official` |

### 1.2 改动审查（PR Review Toolkit）— 已安装待加载

| 项 | 值 |
|---|---|
| 工具/来源 | `pr-review-toolkit@claude-plugins-official`（提交 `ca08d5e47d64`，Anthropic 官方） |
| 组件 | Agents 6：`code-reviewer`、`silent-failure-hunter`、`code-simplifier`、`comment-analyzer`、`pr-test-analyzer`、`type-design-analyzer`；Skill 1：`review-pr` |
| 安全审查 | **Hooks 0、MCP 0、LSP 0** —— 纯提示词组件，不含脚本执行或凭据访问 |
| 成本 | 常驻约 1.6k tokens/会话 |
| 作用域 | user |
| 配置位置 | `~/.claude/settings.json` → `enabledPlugins` |
| 实际验证 | `claude plugin list` 显示 enabled；`claude plugin details` 列出全部 6 agents；`claude plugin validate` 通过 |
| 调用验证 | **未完成**：当前会话技能/agent 列表在启动时固化，新装插件不在其中；独立 CLI 无法认证 |
| 卸载 | `claude plugin uninstall pr-review-toolkit@claude-plugins-official` |

> 本轮约定：该工具**只产出发现**——不自动简化业务代码、不提交 PR 评论、不修改远端仓库。

### 1.3 浏览器操作与页面验收 — 已有且验证通过（未新增）

| 项 | 值 |
|---|---|
| 工具 | `Claude_Browser` MCP（桌面 app 原生，独立浏览器上下文，不接管日常 Chrome 账号） |
| 备选（未启用） | 项目自带 `agent-browser` 0.36.0 CLI、`scripts/browser-smoke`（playwright-core 1.55.0） |
| 实际验证 | 启动本地栈（后端 :3000 + 前端 :5173）→ 打开 `http://localhost:5173` → 真实点击 `#preview-scene-4` → 选中标签由「销售占库」变为「财务会计」，面板内容同步为「货款看来源，凭证查业务。」→ **截图留证** → 读取控制台与网络 |
| 控制台/网络 | 无 error/warn；失败请求仅 `latest.json`、`/api/pda/version` 的 `ERR_ABORTED`（React 重渲染取消 + 开发环境无该静态文件），后端日志同期返回 200，属开发环境噪音 |
| 环境安全 | 已核实 `vite.config.ts` 的 `DEV_API_TARGET` **默认 `http://localhost:3000`**；仅 `.claude/launch.json` 的 `frontend-dev-prod-api` 显式指向生产（jixuflow.com），**未使用该配置** |
| 决策 | **不安装 `microsoft/playwright-mcp`** —— 现有能力已覆盖导航/点击/填写/截图/控制台/网络，避免同类工具重复 |
| 未覆盖 | PDA 真机、Electron 桌面窗口（见 1.4） |

### 1.4 Mac / Electron 桌面操作 — 待授权

| 项 | 值 |
|---|---|
| 工具 | `peekaboo` 3.0.0-beta3（Homebrew：`/opt/homebrew/Cellar/peekaboo/3.0.0-beta3`） |
| 现状 | 已安装，CLI 类别齐全：`capture`/`image`/`list`/`click`/`type`/`hotkey`/`scroll`/`permissions` 等 |
| **阻塞** | `peekaboo permissions` 实测：**Screen Recording = Not Granted、Accessibility = Not Granted**。`peekaboo list apps`、`peekaboo image` 均直接报错要求授权 |
| 最小必要授权 | 系统设置 → 隐私与安全性 → **屏幕录制** 与 **辅助功能**，授权给运行 peekaboo 的宿主进程（桌面 app/终端），用于：观察指定窗口、执行点击输入 |
| 边界 | 只操作明确指定的测试窗口；不采集无关私人窗口、不操作聊天软件。**未授权前一律标记「待授权」，不声称可用** |
| 备注 | 版本为 **beta**（3.0.0-beta3），非稳定版；升级前先核对 release 说明 |

### 1.5 技术文档查询（Context7）— 已连接待加载

| 项 | 值 |
|---|---|
| 工具/来源 | `upstash/context7`（MIT，62.4k stars）经 npm 包 `@upstash/context7-mcp` 以 stdio 接入 |
| 作用域 | user |
| 配置位置 | `~/.claude.json` → `mcpServers.context7` |
| 实际验证 | `claude mcp list` 健康检查 → **✔ Connected** |
| 待办 | 当前会话不会动态连入新 MCP，需新会话 |
| 隐私约定 | 只发送公开技术问题、库名与版本；**不发送业务源码、客户数据、配置或密钥**；需额外付费/注册时先说明，不擅自订阅 |
| 卸载 | `claude mcp remove context7` |

### 1.6 GitHub — 已有且验证通过（未新增）

| 项 | 值 |
|---|---|
| 工具 | `gh` 2.98.0，已认证账号 `chengjianghao439`（keyring 存储，协议 https） |
| 实际验证 | 只读查询 5 个上游仓库元信息（`anthropics/claude-plugins-official`、`microsoft/playwright-mcp`、`upstash/context7`、`github/github-mcp-server`、`openclaw/Peekaboo`）与官方市场清单（314 个插件） |
| 决策 | **不安装 `github/github-mcp-server`** —— `gh` 已覆盖本轮所需的只读能力 |
| 本轮约束 | 不提交、不推送、不合并、不发评论、不改仓库权限（已遵守） |

### 1.7 数据库（MySQL）— 已有且验证通过

| 项 | 值 |
|---|---|
| 工具 | `mysql2` 3.24.4（`backend/node_modules`，项目自带） |
| 目标 | `127.0.0.1:3307 / flowcube_operations20260912_test`（**隔离测试库**，`NODE_ENV=test`） |
| 实际验证 | 直连成功：`SELECT 1` → ok；`DATABASE()` → `flowcube_operations20260912_test`；`VERSION()` → **8.0.46**；`@@time_zone` → **+08:00**；`information_schema` 统计 **143 张表** |
| 容器 | colima profile `flowcube` 运行中，容器 `flowcube-dev-mysql8`（`mysql:8.0`，healthy，`127.0.0.1:3307→3306`） |
| 凭据 | 加载 `~/.config/flowcube/operations20260912-test.env`（变量名核对：`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/JWT_SECRET`，**未回显任何值**） |
| 决策 | **不引入数据库 MCP** —— 现有 mysql2 在合法授权范围内已可只读核查 |
| 本轮约束 | 只做只读查询（`SELECT 1`、`information_schema`），未修改库存/账款/迁移/生产数据 |

### 1.8 服务器 SSH — 已配置，连通性未验证

| 项 | 值 |
|---|---|
| 工具 | `ssh`（OpenSSH 10.3p1），本机别名 `flowcube-prod`（HostName/User/Port/IdentityFile/IdentitiesOnly 均已配置） |
| 本轮 | **不登录生产、不执行部署**；只核对本地配置与部署文档 |
| **发现的缺口** | `~/.ssh/config` 的 `flowcube-prod` 块**没有** `ControlMaster/ControlPath/ControlPersist`。`AGENTS.md` §0.1 红线要求「服务器 SSH 访问必须复用连接…反复新建短连接会被 sshd 限流」。部署链路 `scripts/local-release-relay.py` 在命令行传了这三个参数（有复用），但**手工 `ssh flowcube-prod` 没有** |
| 建议 | 由使用者决定是否在 `~/.ssh/config` 补 `ControlMaster auto` / `ControlPath` / `ControlPersist`；本轮**未擅自修改** |
| 连通性 | **未验证**（本轮不要求，且明确不登录生产） |

### 1.9 项目 Skills（新建 4 个）— 已配置待加载

| 技能 | 触发场景 | 边界要点 |
|---|---|---|
| `flow-business-audit` | 跨模块一致性、业务闭环、改动影响面 | 只产出发现；结论必须标注证据等级；不把历史修复当现状 |
| `flow-ui-acceptance` | 实际操作页面、控制电脑验收、检查 UI | 区分网页/Electron/PDA 模拟/PDA 真机；不用接口测试冒充界面操作 |
| `flow-debug-verify` | 定位 Bug、最小修复、修复后回归 | 编译通过 ≠ 解决；含给 DeepSeek 的任务书模板与独立验收要求 |
| `flow-release-check` | 交付/发布前核对 | 从部署文档与脚本读流程，不凭记忆；区分「已修改…已验证」六态；默认只检查 |

| 项 | 值 |
|---|---|
| 位置 | `~/flowcube/.claude/skills/<name>/SKILL.md`（与项目既有 `release-flowcube` 等同路径约定） |
| 设计 | 只写触发场景、步骤、边界、完成证据；**规则正文引用 `AGENTS.md` 与 `docs/*`，不复制**，避免产生第二份会过期的规则 |
| 实际验证 | `claude plugin validate ~/flowcube/.claude/skills` → **✔ Validation passed** |
| 调用验证 | `Skill(flow-ui-acceptance)` 返回 **Unknown skill** —— 证实技能在会话启动时固化，**需新会话加载** |
| 备注 | 未安装重型多步确认工作流，未添加自动循环或自动部署 hooks |

---

## 2. 本次改动清单（可回退）

| 改动 | 位置 | 回退方式 |
|---|---|---|
| 备份（先于改动） | `~/.config/flowcube/toolchain-backup-20260926/`（权限 700） | 保留；含 `settings.json.bak`、`claude.json.bak`、项目 `settings*.bak` |
| 新增官方市场 | `~/.claude/settings.json` → `extraKnownMarketplaces` | `claude plugin marketplace remove claude-plugins-official` |
| 启用 2 个插件 | `~/.claude/settings.json` → `enabledPlugins` | `claude plugin uninstall <plugin>` |
| 新增 MCP | `~/.claude.json` → `mcpServers.context7` | `claude mcp remove context7` |
| 全局 npm 包 | `typescript-language-server@6.0.1`、`typescript@7.0.2` | `npm uninstall -g typescript-language-server typescript` |
| 新建 4 个技能 | `~/flowcube/.claude/skills/flow-*/` | 删除对应目录 |
| 新建 `~/.claude/launch.json` | 指向 flowcube 前后端（因 `preview_start` 按会话 cwd 查找，当时 cwd 尚未切换） | 删除该文件（原不存在，无覆盖） |
| 本轮新增文档 | 本文件 | 删除 |

**未改动**：任何项目业务代码、`backend/.env`、`deploy/production*.json`、全局模型设置、`ANTHROPIC_BASE_URL` 与密钥、`~/.ssh/config`、其他项目配置。

安装的插件与 MCP 均来自**官方或原维护者仓库**（Anthropic 官方市场 / Upstash），安装前已核对仓库存在性、许可证、组件构成（见 1.2 安全审查）。

---

## 3. 数据库 EPERM 结论

**已查清：是上一轮会话的沙箱网络限制，不是环境配置错误。当前不复现。**

证据链：

1. **同项目文档明确记载**（`docs/system-consistency-audit-2026-09-26.md` §0.1）：按约定加载测试库凭据后，`mysql2` 连接 `127.0.0.1:3307` 返回 `EPERM`；同时确认「凭据加载正常、`mysql2` 可加载、目标库名正确」，并指出「`dangerouslyDisableSandbox` 在本会话被禁用，无法绕过」。
2. **同文档 §0.1-bis 记载解除**：该沙箱限制在后续会话中解除，测试库可读写；并据此把两条缺陷从【代码确证】升级为【数据库核对】+【接口验证】。
3. **跨会话记忆佐证**（`~/.claude/projects/-Users-chengjianghao-flowcube/memory/project_open_decisions.md`）：「上个会话的沙箱限流（连测试库 EPERM）已解除」。
4. **本轮独立复现验证**（最强证据）：当前会话下
   - 裸 TCP 连接 `127.0.0.1:3307` → **成功**；
   - `mysql2` 完整连接 + 查询 → **成功**（143 表、8.0.46、+08:00）；
   - colima `flowcube` profile 运行中、容器 healthy、端口映射正常。

**排除的其他可能**：不是「当前环境不是数据库所在主机」（本机即数据库宿主，colima 本地容器）；不是「服务未运行」（容器 healthy）；不是「端口映射错误」（映射与文档一致）；不是「凭据或库名问题」（查询成功）。

**剩余风险**：沙箱属**会话级**策略，未来若某个会话再次启用网络限制，EPERM 可能重现。届时按同样方法区分——先测裸 TCP，再测客户端，即可判断是沙箱还是真实环境问题。

---

## 4. 仍需你本人执行的操作

1. **授予桌面操作权限**（使用 Electron/桌面验收前必需）
   系统设置 → 隐私与安全性 → **屏幕录制**、**辅助功能**，授权给运行 Peekaboo 的宿主进程。
   授权后验证：`peekaboo permissions` 两项应为 `isGranted: true`。
2. **开启一次新会话**（让本轮配置生效的最小操作）
   插件（typescript-lsp、pr-review-toolkit）、MCP（context7）、4 个项目技能，均需新会话加载。加载后可自查：`claude plugin list`、`claude mcp list`，或在会话中直接调用技能。
3. **（可选）补 SSH 连接复用**：按 `AGENTS.md` §0.1 决定是否在 `~/.ssh/config` 的 `flowcube-prod` 块补 `ControlMaster`/`ControlPath`/`ControlPersist`。
4. **（可选）确认 Context7 是否需要 API Key**：当前未配置密钥即连通；若后续遇到速率限制，再决定是否申请。

---

## 5. 是否已具备开展真实业务闭环验收的条件

**部分具备，可立即开始；桌面端需先完成上面的第 1 项授权。**

| 验收维度 | 是否具备 | 依据 |
|---|---|---|
| 代码导航与跨模块调用关系 | ✅ 具备 | LSP 依赖实测可用（129 处引用/57 文件、跳转准确），插件待新会话加载 |
| 数据库层面的行为核对 | ✅ 具备 | 隔离测试库只读连通、143 表、延迟 1–2ms；EPERM 不复现 |
| 网页界面验收（ERP / PDA 路由） | ✅ 具备 | 本地栈启动成功，导航/点击/截图/控制台/网络全部实测通过 |
| GitHub 只读核查 | ✅ 具备 | gh 已认证并实测 |
| 技术文档检索 | ⚠️ 已连接待加载 | context7 健康检查通过，需新会话 |
| Electron 桌面端验收 | ❌ 待授权 | Peekaboo 缺屏幕录制与辅助功能权限 |
| PDA 真机验收 | ❌ 环境不支持 | 本机无 Android 设备；网页 `/pda/*` 模拟**不能**冒充真机 |

**结论**：网页 + 数据库 + 代码导航三条线的业务闭环验收**现在就可以开始**。涉及 Electron 桌面窗口的验收，需先完成屏幕录制/辅助功能授权；PDA 真机验收本机不覆盖，须如实标注「未验证」。
