# Codex 模型提供方与上下文边界（2026-09-17）

记录日期：2026-09-17。起因：用户改用 DeepSeek 官方 API（`deepseek-flash`）驱动 Codex 开发极序 Flow，要求核查当前配置、现状与项目规定中不合理的地方。本文保留核查证据、本次实际改动、兼容性差异与剩余待办；现行规则摘要见 `AGENTS.md` 第 1 节。

未验证项已明确标注；本文不代表对生产数据库或线上部署的核验。

## 1. 当前配置（2026-09-17 实测）

| 字段 | 值 | 说明 |
|---|---|---|
| `model` | `deepseek-flash` | 视觉可用；`deepseek-v4-pro` 不支持图片 |
| `model_provider` | `deepseek` | `[model_providers.deepseek]`，`wire_api = "responses"`，`base_url = https://api.deepseek.com/` |
| `model_catalog_json` | `~/.codex/models.json` | 声明 `deepseek-flash`、`deepseek-v4-pro` 与 1M 上下文、推理档位等元数据 |
| `preferred_auth_method` / `forced_login_method` | `apikey` / `api` | 跳过 ChatGPT 账号登录 |
| `web_search` | `disabled` | DeepSeek 忽略内置联网搜索工具，必须显式关闭 |
| `model_reasoning_effort` | `high` | 支持 `low` / `high` / `max` |
| `approval_policy` / `sandbox_mode` | `never` / `danger-full-access` | 切换提供方前即为该值，无工具级拦截 |
| `personality` | `pragmatic` | 自定义目录下实测不生效，见 5.2 |
| `shell_environment_policy` | `inherit = "core"`，`exclude = ["DEEPSEEK_API_KEY"]` | `exclude` 为 2026-09-17 新增 |

配置来源可查证：`~/.codex/backup-deepseek/manifest.txt` 记录 `script_version=1.3.0`、`installed_at=2026-09-14 18:52:16`，即 DeepSeek 官方《Integrate with Codex》一键脚本的产物，不是手改配置。

## 2. 核查为正常的部分

- 端点为真实 DeepSeek：TLS 证书 `CN=api.deepseek.com`，签发者 TrustAsia DV TLS RSA CA 2025。
- 目录声明与官方文档《Models & Pricing》一致：1M 上下文、384K 最大输出、Responses API、工具调用、JSON 输出。
- 视觉实测通过：以 64×64 纯红 PNG 调用 `deepseek-flash` 的 `input_image`，返回 `Red`；官方文档明确 `deepseek-v4-pro` 的 Vision 为 Not supported。
- 本会话用量：输入 200,472 token，其中缓存命中 165,376（82%），provider 无报错。

## 3. 本次已完成

### 3.1 API Key 明文扩散（已清理）

问题：Key 同时存在于 `~/.codex/config.toml` 的 `experimental_bearer_token`（官方脚本写法，本身可接受）、`~/.zshrc` 的 `export DEEPSEEK_API_KEY` 和三处 `launchctl setenv`。由于 Codex 每个会话会生成 `~/.codex/shell_snapshots/<thread>.sh` 并记录当时环境，**每一次新会话都会把 Key 明文写盘**；实测命中 23 个文件，其中 20 个为权限 644 的 shell 快照。

处理：`~/.zshrc` 移除导出与 `launchctl` 行（改留说明注释）；`launchctl unsetenv DEEPSEEK_API_KEY`；23 个文件内的 Key 等长替换为 `sk-REDACTED…` 占位，`config.toml` 保留唯一副本；`shell_snapshots`、`backup-deepseek` 目录收紧为 700、快照 600；`config.toml` 增加 `shell_environment_policy.exclude = ["DEEPSEEK_API_KEY"]`。

验证：脱敏后全 `~/.codex` 仅 `config.toml` 命中该 Key；两个 `.jsonl`（本会话与 2026-09-04 归档会话）逐行解析通过，0 条无效；`zsh -n ~/.zshrc` 通过；`python3 -c "tomllib.load(...)"` 解析 `config.toml` 通过；`env -u DEEPSEEK_API_KEY` 下用 `config.toml` 中的 Key 调用 `/v1/responses` 返回 200 且 `status=completed`，证明认证不依赖环境变量。

密钥轮换：用户于 2026-09-17 明确**暂不轮换**，保留现有 Key。因此该 Key 的有效副本仍有且仅有一份明文文件 `~/.codex/config.toml`（600，官方脚本要求的存放位置）；历史副本已全部脱敏为占位符。残余风险与复检条件：脱敏后的 23 个文件仍在磁盘上（仅占位符，无法还原）、本机所有进程历史上都拿到过该 Key；若之后出现 Key 使用异常、余额变化或需要对外分享本机备份/日志，应立即轮换并重新执行第 6 节核验。测试库、开发库与其它项目目录未发现该 Key。

待用户操作：**重启 Codex 应用**——正在运行的进程仍持有启动时从 `launchctl` 拿到的旧环境变量，重启后新会话的 shell 快照才不再带 Key（本次清理过程中实测到一次新快照带上旧 Key，已随即脱敏）。

导出移除后的影响范围：Codex 自身使用 `config.toml` 的 token，不需要环境变量（已用 `env -u DEEPSEEK_API_KEY` 实测）。历史项目 `~/Documents/Codex/2026-08-18/cha/outputs/deepseek-harness` 之类自行读取 `process.env.DEEPSEEK_API_KEY` 的工具，需要时按需临时注入（例如 `export DEEPSEEK_API_KEY=$(rg -o 'sk-[A-Za-z0-9]{32}' -N -m1 ~/.codex/config.toml)`），不要重新写回 `~/.zshrc`。

### 3.2 陈旧备份归档

`config.toml.ccr-backup-*`（4 份）、`config.toml.ccr-original`、`config.toml.before-restore-20260916-021002`、`.codex-global-state.json.before-restore-20260916-021002` 已移入 `~/.codex/backup-deepseek/legacy-2026-09-17/`。`config.toml.before-deepseek-*`、`.codex-global-state.json.before-deepseek-*` 与 `backup-deepseek/config.toml` 保留原位，供官方脚本的还原路径使用。

### 3.3 项目规则补"上下文边界"

`AGENTS.md` 与 `CLAUDE.md`、`docs/` 此前对模型提供方**零命中**，即"哪些内容可以进入云端提示词"没有任何规定。已在 `AGENTS.md` 第 1 节新增模型提供方与上下文边界条款（不改变既有章节编号，避免其它文档引用的"第 3/5/6 节"失效）。

## 4. 兼容性差异（官方文档 + 实测）

DeepSeek 的 Responses API 是兼容实现，以下差异会直接影响本项目的使用方式：

| 项目 | 状态 | 对极序 Flow 的影响 |
|---|---|---|
| `web_search` / `file_search` / `code_interpreter` / `computer_use` / `mcp` 内置工具 | 忽略 | 内置联网搜索不可用；查官方文档、依赖版本、漏洞公告必须显式 `curl` / `gh` |
| `parallel_tool_calls` / `max_tool_calls` | 忽略 | 始终并行；Codex 的单轮工具调用上限不生效，长任务的并发与额度不能按本地设置推断 |
| `store` / `previous_response_id` / `conversation` | 不支持（无状态） | 每轮全量重发上下文，费用与延迟由缓存命中率决定（命中 $0.003/M vs 未命中 $0.15/M，差 50 倍）。中途改 `AGENTS.md`、增减技能或 MCP 会打断前缀缓存 |
| `truncation` | 不支持 | 超过 1M 上下文直接返回 400，不会自动截断 |
| `reasoning.summary` | 接受但不生成 | 看不到思考摘要（`default_reasoning_summary = "none"` 与之一致） |
| `input_image` | 仅限 user / developer 消息与工具输出 | 图片出现在 system / assistant 消息会 400 |
| 自定义工具 | 仅 `apply_patch` | 其它 `{type:"custom"}` 工具会 400 |
| 视觉 | 仅 `deepseek-flash` | 切到 `deepseek-v4-pro` 会失去截图验收能力，本项目大量依赖 ERP / PDA / 打印预览截图 |

## 5. 剩余风险与待办

### 5.1 审批与沙箱（2026-09-17 已决定：维持现状）

用户明确选择"已授权操作不重复询问"，即**保持** `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`，不引入审批中断。这意味着项目规则第 5、6 节中"不执行 `git push`、不打 tag、不删数据、不手改缓存"依旧只靠模型自觉，工具层没有拦截；已授权范围内的动作直接执行，需要新授权的动作按第 1 节边界停手询问。若之后要求收紧，改 `approval_policy` 为 `on-request`（或对生产目录单独设 trust）即可，代价是发版与运维多出人工确认。

### 5.2 `personality = "pragmatic"` 实测不生效

`~/.codex/models.json` 的 `instructions_template` 把人格段落写死为默认版本，`instructions_variables` 的三个字段为空字符串；当前会话实际收到的即为默认人格文本。该字段仅在切回官方目录时可能重新生效，故**不删除**，但不要依赖它调整行为。

### 5.3 Codex 应用升级后目录陈旧

`models.json` 内含约 17.7k 字符的 Codex 系统提示词快照（写入于 2026-09-14），桌面端已是 26.911.61220，条目还带 `minimal_client_version: 0.144.0` 契约。应用升级会改变提示词与工具集，快照不会自动跟进。**升级 Codex 后重跑官方脚本（菜单 1）刷新 `models.json`**，不要长期沿用旧快照。

### 5.4 会话历史分组

官方文档说明：第三方 API 登录方式的会话与 ChatGPT 订阅会话分组存放，切到 DeepSeek 后旧会话在界面中不可见，切回官方配置后恢复显示，**不是删除**。

### 5.5 数据边界仍靠规则执行

第 3.3 节的条款是约定而非技术强制。上下文边界之外，流量还经本机代理 `HTTPS_PROXY=http://127.0.0.1:7897`；`chronicle` 开启时屏幕内容、`memories` 摘要都随会话发往提供方。需要生产事实核对时按 `AGENTS.md` 第 1 节处理：由用户执行只读查询，或先脱敏再带回结论。

## 6. 复现与核验命令

```bash
# 当前生效的提供方与目录
python3 -c "import tomllib;d=tomllib.load(open('$HOME/.codex/config.toml','rb'));print(d['model'],d['model_provider'],d['shell_environment_policy'])"

# 是否还有 Key 残留（应只列出 config.toml）
KEY=$(rg -o 'sk-[A-Za-z0-9]{32}' -N -m1 "$HOME/.codex/config.toml")
rg -l -F "$KEY" "$HOME/.codex"

# 不依赖环境变量的认证与视觉自测
env -u DEEPSEEK_API_KEY curl -s https://api.deepseek.com/v1/responses \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","input":"ok","max_output_tokens":32}'

# 模型列表与兼容性差异来源
curl -s https://api.deepseek.com/models -H "Authorization: Bearer $KEY"
curl -sL https://api-docs.deepseek.com/guides/responses_api
```

切回官方 ChatGPT 登录：执行 DeepSeek 官方脚本的菜单 9（还原 `config.toml` 与目录），或在 `config.toml` 中移除 `model_provider`、`model_catalog_json`、`preferred_auth_method`、`forced_login_method`、`web_search` 与 `[model_providers.deepseek]` 段后重启应用；本文件 3.1 的 `.zshrc` 与权限改动无需回退。
