# v0.9.3 发布范围与验证

目标：发布服务器资源保护、运维误报修复和客户端来源兼容。PDA versionCode 111。

本次在独立工作树准备，不把原目录的 Codex 个人配置、开发命令、MySQL 开发容器或其他环境整理纳入发布。项目密码代输授权和发版技能说明随对应项目文档维护。

## 明确纳入的文件

- `.dockerignore`
- `.env.example`
- `.github/workflows/deploy-browser.yml`
- `.github/workflows/test.yml`
- `backend/.env.example`
- `backend/src/app.js`
- `backend/src/config/cors.js`
- `scripts/monitor.sh`
- `scripts/restore-check.sh`
- `scripts/server-update.sh`
- `scripts/release-gate.sh`
- `scripts/build-deploy-images.sh`
- `scripts/lib/runtime-guards.sh`
- `tests/audit-deployment.test.js`
- `tests/deployment-resources.test.js`
- `tests/ops-monitor-restore.test.js`
- `tests/cors-policy.test.js`
- `docs/DEPLOY.md`
- `docs/RELEASE.md`
- `docs/runbooks/failure-recovery.md`
- `docs/production-environment-check-2026-09-04.md`
- `docs/superpowers/plans/2026-09-04-production-environment-repair.md`
- `docs/superpowers/plans/2026-09-05-deployment-resource-guards.md`
- `CLAUDE.md`
- `.agents/skills/release-flowcube/SKILL.md`
- `AGENTS.md`
- `docs/release-notes/0.9.3.md`

另包含本文件与三端 package.json/package-lock.json、frontend/android/app/build.gradle、backend/apk/version.json 的 v0.9.3 版本同步。

## 验证与状态

- 干净基线：22 项部署/工具回归通过。
- 发布候选：89 项部署/运维/CORS/客户端回归、69 项前端单测通过；两端 lint 通过（前端仅保留 5 条既有 warning）、app TypeScript 检查、ERP/PDA Web 构建通过。
- 两个改动工作流通过 actionlint，相关 Bash 通过 ShellCheck 与语法检查，36 个候选文件 gitleaks 扫描未发现泄漏。
- 01:09 发布前备份：135 表，数据库压缩包 184279 字节，SHA-256 `d7086dc663c702603e150ba6bda87e262b8370aebeeef313ffeb00be68ae0b75`；生产配置、旧镜像 ID、客户端清单已保存，另复制至 Mac 并核验摘要。未修改业务数据。
- 本文件记录发布前快照；最终上线状态以 v0.9.3 tag 对应 SHA 的 Actions 和生产 `/api/health`、桌面/PDA 版本清单为准，不能用该文档代替实际验收。
- 后端已支持精确 CORS 来源列表，本版先保留现有生产兼容配置，来源收窄须单独验证客户端后切换。
- 原开发工作区与私人配置保留，未导入发布镜像；本版不增加数据库迁移。

合并前审查发现并修复了嵌套 GNU timeout 进程组导致回退被强杀的问题；旧实现真实缩时回归失败（SIGKILL、清理未执行），修正后清理/回退均执行且测试进程退出。审查未发现其他已确认的高/中风险阻断。
