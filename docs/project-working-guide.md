# 极序 Flow 项目工作指南

[AGENTS.md](../AGENTS.md) 是协作和约束入口。本指南用于开工、并行分工和交接。[验证命令](verification-commands.md)列出专项检查，[发布说明](RELEASE.md)与[部署说明](DEPLOY.md)记录现行发布流程。

## 开工核对

1. 记录仓库根目录、工作树路径、分支和完整提交 SHA。用 `git status --short --branch`、`git diff HEAD` 和 `git worktree list` 核对已修改及未跟踪文件，保留已有工作。涉及最新主线、发布或验收版本时，分别核对远端分支、标签和运行证据。
2. 用远端 `main` 的已核实提交作为新任务基线。接续旧工作时核对该工作树的独有提交、未提交改动和任务状态。发现本地与远端分叉时先查差异来源。
3. 按根规则索引读取领域细则。若说明和实现冲突，记录两边的依据、影响和待确认事项，继续处理不依赖该矛盾的工作。以当前代码、迁移及核实过的配置描述现行行为。
4. 记下任务目标、预计改动路径、共用文件负责人、环境和验收方式。确认谁负责最终集成以及哪些操作已有授权。

## 并行分工和接续

- 需要同时写代码的独立任务各用自己的工作树和分支，默认使用 `codex/` 前缀。路由、权限表、迁移编号、生成文件和 CI 等共用入口由一位负责人统一整合。其他任务提交具体需求、补丁或复核证据。
- 工作树隔离 Git 文件。启动应用前仍要核对数据库、端口、容器、卷和进程归属。新工作树不继承后端环境文件。使用专属合成环境变量，启动后核对实际应用、数据库与端口。
- 按实际差异判断补丁是否已随其他提交合入。核对独有提交、忽略文件和正在使用的资源后，再处理旧工作树。用途或可恢复性不明的工作区先保留。
- 本机环境清单、停启记录和原始验收资料按原处保留。共享交接只写可公开的结论和可复核的引用，机器专属资料标为本机证据。

## 环境和验收

- 开发库可能已有数据。启动数据库和迁移分别执行。全新空库使用[新装初始化入口](DEPLOY.md#全新空库初始化)，已有库使用当前升级流程。
- 测试使用归属已核实的独立实例和合成数据。写入前核对实际回环地址、库名、容器、卷和应用连接，确认外发、打印及后台任务的边界。停数据库前先查数据目录的实际存储，细则见[本地预览验收](local-preview-acceptance.md)。
- 正式环境按授权范围操作。发布状态分开记录 Git 提交、远端引用、工作流结论、部署和线上验收。Windows 安装更新、Android 真机扫码和实际出纸各自记录证据。
- 交接前按改动范围核对 diff 和专项检查。记录命令实际退出结果、环境和限制。失败后先确认是否产生部分效果，再判断能否重试。

## 交接卡

用现有任务记录或 PR 保存。接手人先重新核对前两项，再按最后一项继续。

| 字段 | 填写内容 |
|---|---|
| 基线和路径 | 任务目标、仓库、工作树、分支、完整基线与当前 SHA |
| 范围与负责人 | 预计和实际改动路径、既有未提交项、共用文件写入者、集成人 |
| 环境与资源 | 执行测试的环境和实例标识、已创建资源、停启及保留状态 |
| 代码状态 | 已实现、已提交、已推送、已合入分别注明，附可复核引用 |
| 发布和证据 | 部署、验收分别注明。列实际命令、退出结果、记录位置及未验证范围 |
| 下一步 | 尚未解决的事项、需要谁决定、从哪条安全步骤继续 |

## 文档随改动更新

本次变更的负责人更新对应说明，集成人在交接时核对链接和依据。能从配置和脚本读取的版本、端口、命令和超时，直接引用生效的来源。说明里保留使用条件、操作顺序和失败处置。

| 何时更新 | 更新哪里 | 核对依据 |
|---|---|---|
| 业务行为、模块边界或协作规则改变 | 对应主题文档，与改动同批提交。全仓规则及主题入口变化时更新 [AGENTS.md](../AGENTS.md) | 实现、迁移和相关回归 |
| 本地安装、启动或验收入口改变 | 更新 [README](../README.md)、[本地预览验收](local-preview-acceptance.md) 中受影响的步骤 | [版本选择](../.nvmrc)、[命令清单](../package.json)、启动脚本和实际服务地址 |
| 测试、发布或恢复方式改变 | 更新受影响的 [验证命令](verification-commands.md)、[发布说明](RELEASE.md) 或 [部署说明](DEPLOY.md) | 工作流、实际执行的脚本和契约测试 |
| 验收有结果、确认跳过，或生产发布完成一个阶段 | 在当次验收或发布记录补记时间、完整 SHA、运行链接和结果。待执行的标为待验证，确认跳过的写明原因 | GitHub 对应运行、实际部署结果或设备验收记录 |

历史报告保留当日结论、环境和证据。验收重跑或结论变化时追加日期、对应提交和新证据。准备交接或发布时，重新核对报告中会影响本次操作的状态。

## GitHub 主线保护方案

2026-11-19 已在正式仓库启用规则，仅保护 `main`。所有改动必须走 PR，禁止强推和删除 `main`，绕过名单为空。PR 分支必须跟上最新的 `main`，且 GitHub Actions 的 `Tests PR Gate` 和 `Security Scan PR Gate` 必须通过。GitHub 强制审批数为 0，实际合并仍须用户明确授权。[正式规则集](https://github.com/chengjianghao439/flowcube2026/rules/27616515)

### Agent 提交和合并 PR

1. **提交 PR。** 从已核对的 `origin/main` 建任务分支，默认使用 `codex/` 前缀。按授权推送任务分支，创建目标为 `main` 的 PR。说明改动范围、验证结果、待验收项和对应的提交或运行链接。尚在开发或暂缓合并时使用草稿 PR。
2. **分支落后时先更新。** GitHub 提供 **Update branch** 且能自动更新时，可按授权使用该按钮。需要本地处理时，先在任务工作树核对当前分支并保全未提交改动，再运行 `git fetch origin` 和 `git merge origin/main`。如有冲突，核对两边改动并复验受影响范围，再按授权将更新推回原 PR 的任务分支。
3. **以最新提交的检查结果为准。** 更新分支后等两道门禁在新提交上重新运行并通过。检查尚未完成就等待。失败、取消或跳过时，查明原因并等门禁重新通过。申请合并时向用户提供当前提交和两道门禁的结果。执行合并前确认用户已明确授权、PR 已退出草稿、GitHub 显示可合并、分支仍跟上 `main`，且通过检查的提交仍是 PR 的最新提交。
4. **部署另行授权。** 合并触发检查和桌面验证构建。网页、PDA 和桌面正式发布按授权执行，发布步骤和提交校验见[发布说明](RELEASE.md)。

### 2026-11-19 演练记录

- **红灯拦截与合并触发。** 两道门禁分别单独失败时，GitHub 两次返回 405 并拒绝合并。两道通过后才合入演练仓库的 `main`。合并提交 `b4c19e3` 只触发测试、安全扫描和桌面验证三个占位工作流，全部通过。[演练 PR #1](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/pull/1) · [测试红灯](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44471564792/job/135382085345) · [安全扫描红灯](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44471674469/job/135382444834) · [合并后测试](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44471807045) · [合并后安全扫描](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44471807052) · [合并后桌面验证](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44471807044)
- **落后主线与更新重跑。** 演练 PR #2 推进 `main` 后，已通过两道门禁的 PR #3 落后一个提交，GitHub 返回 405。更新分支后，GitHub 再次拒绝合并，提示两道检查都在等待结果。新提交 `c529454` 的两道检查都通过后，PR #3 才合入。[推进主线的 PR #2](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/pull/2) · [演练 PR #3](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/pull/3) · [重跑测试](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44475497013/job/135395010042) · [重跑安全扫描](https://github.com/chengjianghao439/flowcube-main-protection-rehearsal-public-20261119/actions/runs/44475496929/job/135394961401)
