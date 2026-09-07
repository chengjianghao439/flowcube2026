# 历史依赖 PR 与 Claude 工作树清理（2026-09-07）

核对基线：`main` / `2cd4589a8da8121bc8cfe2455e5b584afbe80e50`。按用户要求处理 22 个 Dependabot PR，并核对、清理 Claude 旧工作树。此次不升级依赖、不修改业务逻辑，不合并 PR，不发布版本。

## 依赖 PR 处理依据

逐项核对 PR 实际 package/lock 差异、当前 main 的依赖声明与锁定版本、分支落后提交数以及 GitHub 上的检查结果。旧检查针对历史分支，不能视为当前主线兼容性证明。

- 5 项目标已被当前锁文件覆盖，或直接依赖已移除：#3、#13、#19、#28、#36。
- 11 项为大版本迁移或与当前运行时/工具链基线不一致：#4、#6、#7、#8、#10、#11、#12、#16、#35、#37、#38。
- 6 项为尚未采用的同大版本升级：#2、#14、#15、#17、#30、#32。旧分支落后 main 300–427 个提交，4 项有合并冲突；本次按清理范围结束旧提案，保留当前已验证版本。以后有升级需要时，应从当时 main 重新准备并验证，不能把本次关闭写成升级已完成。
- 22 项均已关闭，并逐项留下理由；Dependabot 配置保持启用，后续仍可能提出新版本更新。

| PR | 依赖 | 当前锁定版本 | 提案版本范围 | 决定与理由 |
|---|---|---|---|---|
| [#2](https://github.com/chengjianghao439/flowcube2026/pull/2) | `@capacitor/android` | `8.2.0` | `^8.3.4` | 关闭。这是 Capacitor Android 同大版本升级，旧 PR 与当前 main 冲突。原生依赖应结合 core、插件和 Android 真机验证同步处理，本次保留当前组合。 |
| [#3](https://github.com/chengjianghao439/flowcube2026/pull/3) | `uuid` | `11.1.1` | `^14.0.0` | 关闭。当前 backend/package.json 已移除 uuid 直接依赖；不应通过这个旧 PR 恢复已移除的依赖。传递依赖由其上游维护。 |
| [#4](https://github.com/chengjianghao439/flowcube2026/pull/4) | `@eslint/js` | `9.39.3` | `^10.0.1` | 关闭。当前前端使用 ESLint 9；@eslint/js 10 应随 ESLint 主版本及规则配置一起迁移，不单独合入。 |
| [#6](https://github.com/chengjianghao439/flowcube2026/pull/6) | `@types/node` | `22.19.13` | `^25.8.0` | 关闭。项目运行时与 CI 明确使用 Node 22；本 PR 将前端 Node 类型升至 25，与当前运行时基线不一致。 |
| [#7](https://github.com/chengjianghao439/flowcube2026/pull/7) | `bcryptjs` | `2.4.3` | `^3.0.3` | 关闭。bcryptjs 2 → 3 为认证依赖大版本迁移，需要验证既有密码哈希及登录流程；本次保留现有认证基线。 |
| [#8](https://github.com/chengjianghao439/flowcube2026/pull/8) | `zod` | `3.25.76` | `^4.4.3` | 关闭。当前后端仍使用 zod 3，zod 4 是 API 参数校验的大版本迁移，需要覆盖全部路由契约；不作为旧分支清理直接合入。 |
| [#10](https://github.com/chengjianghao439/flowcube2026/pull/10) | `globals` | `15.15.0` | `^17.6.0` | 关闭。前端 globals 15 → 17 属于 lint 环境定义大版本调整，需与当前 ESLint 配置一起验证；本次保留现有工具链。 |
| [#11](https://github.com/chengjianghao439/flowcube2026/pull/11) | `dotenv` | `16.6.1` | `^17.4.2` | 关闭。dotenv 16 → 17 为大版本迁移，需验证项目配置加载约定；本次旧 PR 清理不变更环境加载行为。 |
| [#12](https://github.com/chengjianghao439/flowcube2026/pull/12) | `@vitejs/plugin-legacy` | `6.1.1` | `8.0.2` | 关闭。当前前端使用 Vite 6；legacy 插件 8 应与 Vite 工具链及旧 WebView 构建一起迁移，本次保留已验证组合。 |
| [#13](https://github.com/chengjianghao439/flowcube2026/pull/13) | `postcss` | `8.5.26` | `^8.5.14` | 关闭。当前 main 锁文件已使用 PostCSS 8.5.26，高于本 PR 的 8.5.14；旧提案已被覆盖。 |
| [#14](https://github.com/chengjianghao439/flowcube2026/pull/14) | `core-js` | `3.48.0` | `^3.49.0` | 关闭。这是非紧急的 core-js 同大版本升级，旧 PR 与当前 main 冲突。本次结束历史提案；以后升级需重新验证 ERP/PDA legacy 兼容构建。 |
| [#15](https://github.com/chengjianghao439/flowcube2026/pull/15) | `zustand` | `5.0.11` | `^5.0.13` | 关闭。这是非紧急的 Zustand 补丁升级，分支落后当前 main 427 个提交，旧 CI 无法证明当前多账套及会话状态兼容。本次保留现有版本并结束历史提案。 |
| [#16](https://github.com/chengjianghao439/flowcube2026/pull/16) | `vite` | `6.4.3` | `^8.0.13` | 关闭。当前前端使用 Vite 6 与 legacy 插件 6；Vite 8 应与插件及 ERP/PDA 兼容构建一起迁移，不能单独合入旧锁文件。 |
| [#17](https://github.com/chengjianghao439/flowcube2026/pull/17) | `typescript-eslint` | `8.56.1` | `^8.59.3` | 关闭。这是非紧急的 typescript-eslint 同大版本升级，旧 PR 与当前 main 冲突。本次结束历史提案；以后应基于当前 ESLint/TypeScript 组合统一验证。 |
| [#19](https://github.com/chengjianghao439/flowcube2026/pull/19) | `express` | `4.22.2` | `^4.22.2` | 关闭。当前 main 锁文件已使用 express 4.22.2；本 PR 的运行版本目标已经完成，现有依赖声明仍兼容此版本。 |
| [#28](https://github.com/chengjianghao439/flowcube2026/pull/28) | `electron-builder` | `26.15.3` | `^26.15.3` | 关闭。当前 main 已固定 electron-builder 26.15.3，并已同步锁文件；本 PR 的目标已经完成。 |
| [#30](https://github.com/chengjianghao439/flowcube2026/pull/30) | `semver` | `7.7.4` | `^7.8.5` | 关闭。这是非紧急的 semver 同大版本升级，旧 PR 与当前 main 冲突，最近回归检查失败。本次结束历史提案；以后升级需基于当前桌面更新逻辑重新验证。 |
| [#32](https://github.com/chengjianghao439/flowcube2026/pull/32) | `helmet` | `8.1.0` | `^8.3.0` | 关闭。这是非紧急的 helmet 同大版本升级，分支落后当前 main 314 个提交，最近检查针对旧基线。本次结束历史提案并保留现有版本；以后升级需从当前 main 重新验证安全响应头。 |
| [#35](https://github.com/chengjianghao439/flowcube2026/pull/35) | `express-rate-limit` | `7.5.1` | `^8.6.1` | 关闭。express-rate-limit 7 → 8 为大版本迁移，需连同现有限流配置和代理 IP 行为专项验证。本次清理不改变线上限流实现。 |
| [#36](https://github.com/chengjianghao439/flowcube2026/pull/36) | `mysql2` | `3.24.3` | `^3.23.2` | 关闭。当前 main 锁文件已使用 mysql2 3.24.3，高于本 PR 的 3.23.2；旧锁文件升级已被后续版本覆盖。 |
| [#37](https://github.com/chengjianghao439/flowcube2026/pull/37) | `eslint` | `9.39.5` | `^10.8.0` | 关闭。当前后端使用 ESLint 9；ESLint 10 属于工具链大版本迁移，本次旧 PR 清理保留现有工具链。该 PR 与当前 main 冲突。 |
| [#38](https://github.com/chengjianghao439/flowcube2026/pull/38) | `@eslint/js` | `9.39.5` | `^10.0.1` | 关闭。当前后端使用 ESLint 9。@eslint/js 10 应与 ESLint 主版本及规则配置一起迁移，不单独合入这一历史升级。 |

## Claude 旧工作树审查

原目录：`/Users/chengjianghao/flowcube/.claude/worktrees/compassionate-hugle-7c77c6`，原分支：`claude/compassionate-hugle-7c77c6`，HEAD：`29b7de6600115c09872ba24601aef8deb0bed963`。已确认 HEAD 是 main 祖先，分支没有独有提交。

- 原状态为 2 个已跟踪文件修改与 33 个未跟踪文件。
- `price-change.service.js` 的旧实现允许没有审批流时单级通过/驳回；当前 `AGENTS.md` 第 8 节、服务实现和 `tests/audit-finance-security.smoke.test.js` F10 均要求无匹配审批流返回 `409 / PRICE_CHANGE_APPROVAL_FLOW_REQUIRED`。旧实现与现行安全规则冲突，归档后舍弃，不覆盖当前主线。
- 旧实现新增自批校验是其单级审批路径的配套逻辑；当前没有该路径，审批由既有引擎执行，本次没有将旧路径重新引入。
- `CLAUDE.md` 是旧文档版本，仍将自身称为唯一权威说明并描述无流程单级审批，当前已经统一由 AGENTS.md 承载现行规则，不回填旧正文。
- 26 个文件内容已与 main 完全一致；5 个 impeccable 参考文件仅有空白差异；旧发版技能仍引用失效路径、全量暂存与缺少同 SHA 门禁的旧流程，保留当前技能。
- 旧 `.codex/hooks.json` 是已经停用的 EnterWorktree hook，不能恢复为现行初始化机制。

处理：保留当前 main 实现；删除旧工作树和已合并的本地分支。删除前 lsof 没有发现该目录内的打开文件；归档前后核对工作树状态，逐文件 SHA-256/符号链接校验通过后才移除。

## 本机恢复材料

私有备份目录：`/Users/chengjianghao/.config/flowcube/cleanup-backups/20260907-pr-claude`（目录权限 700）。

- `claude-worktree.tar.gz`：1,366 个文件，2,590,720 字节，权限 600；保留源码、文档、未跟踪文件及忽略的本机配置，排除可重新安装的 node_modules 和工作树 `.git` 指针。
- 归档 SHA-256：`726bb419713d42c3fa66da1d344410894f60adc793a452cb3bdc403d6da05d76`。
- `claude-head.txt`、`claude-tracked.patch`、`claude-status-before.txt`、`claude-ignored-paths.txt`、`claude-files-manifest.json` 用于恢复和核对；备份含本机私有配置，只保存在本机，不上传仓库或第三方。
- PR 的原始状态、差异摘要、逐项理由、关闭回执和三端 audit JSON 同目录保存。

若需要恢复，应先新建停在原 HEAD 的独立工作树，再将归档解入该工作树；不要直接解压覆盖当前 main。

## 本次验证及边界

- backend、frontend、desktop 分别执行完整 `npm audit --json`（未省略 dev 依赖），退出码均为 0，三端均报告 0 漏洞。该结果只代表当次已知漏洞数据库检查。
- 对当前实际改价 service 执行 4 项隔离调用检查：无流程 submit、无实例 approve/reject 均返回 409、回滚、释放连接且不执行写 SQL；有效流程 submit 保存实例并提交。4 通过、0 失败。数据库和审批引擎使用替身，此结果不是数据库或端到端回归。
- GitHub 已确认 22 个关闭回执；对应远程分支在关闭后自动删除。
- 主线依赖文件、业务代码、版本号、Dependabot 配置未改；本次只同步本清理说明和 AGENTS.md 工作约定。
- `prelaunch-fixes-20260905` 的 97 项历史改动及其他发布工作树保持原样；不属于本次 Claude 工作树清理范围。
