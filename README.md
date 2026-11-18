# 极序 Flow

极序 Flow 是单租户 ERP／WMS。浏览器、Windows 桌面和 Android PDA 共用 React 前端。Express 后端统一处理业务规则，MySQL 保存库存、订单和账款。

## 从这里开始

1. 阅读 [AGENTS.md](AGENTS.md) 与 [项目工作指南](docs/project-working-guide.md)。确认当前工作树、基线提交、已有改动和交接范围。
2. 本地切到 Node 22，最低 `22.13.0`，运行 `npm run dev:setup` 安装锁定依赖。新工作树使用自己核对过的环境配置。先按 [本地预览验收](docs/local-preview-acceptance.md) 确认专属回环数据库、端口和合成账号，再启动服务。
3. 使用 `npm run dev:backend` 启动后端，`npm run dev:erp` 打开 ERP 开发端，`npm run dev:pda` 打开 PDA 开发端。开发库、全新空库和恢复副本各走 [部署说明](docs/DEPLOY.md) 定义的入口。
4. 按 [验证命令](docs/verification-commands.md) 选择专项。发布按同一份 [发布说明](docs/RELEASE.md) 执行，核对实际授权和设备验收范围。

## 目录

| 路径 | 职责 |
|---|---|
| `backend/src/modules/`、`backend/src/engine/` | 业务入口、规则、库存与状态事务 |
| `backend/src/database/` | SQL 迁移与新库初始化 |
| `frontend/src/` | 浏览器、桌面和 PDA 的页面、API 与状态管理 |
| `desktop/`、`frontend/android/` | Windows 外壳和 Android 原生工程 |
| `agent/` | 小满任务和与 ERP API 的交互 |
| `tests/`、`scripts/`、`docs/` | 验收回归、开发和交付工具、现行主题说明 |
