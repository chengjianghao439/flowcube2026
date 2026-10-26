# 极序 Agent 本地接入计划

> 执行方式：使用 writing-plans、test-driven-development 与 requesting-code-review；主任务实现，独立审查核对现有 API。工作范围仅为本地工作树。

**目标：** 将 Muse 的 0.1.0 服务及抽屉接入当前极序 Flow，提供真实本地 API 上可复核的交互结果。

**架构：** 服务放在 `agent/`，保留确定性任务图、L2 人工确认和正式 Flow API。前端顶栏按显式开发开关挂载抽屉，以 Vite 同源 `/agent-api` 代理转发，默认不进入发布产品。独立测试数据和运行目录位于仓库外；不迁移已有开发库。

**技术：** Node 22、原生 HTTP、React、现有 Radix Sheet、Vite、node:test、Vitest。

## 1. 来源与基线

- [x] 核对干净工作区、工作树、当前 HEAD 与原有 5197 服务归属。
- [x] 保存原 ZIP，安全解压到临时目录，原包 67 个 mock 用例通过。
- [x] 将原包 `service/src`、`service/test` 导入 `agent/`；README 改为当前接入说明，历史沙箱记录不作本机证据。

## 2. 服务边界与正式契约

文件：`agent/src/config.js`、`server.js`、`flow.js`、`tasks.js`、`agent.js`、`agent/test/local-integration.test.js`。

- [x] 先以真实 HTTP 测试复现任务查询未登录/跨用户读取、过期权限缓存、超大/非法正文；确认互斥另经源码审查，未作 HTTP 压力验收。预置仅合成任务，断言 `assert.equal(response.status, 401)` / `403` / `400` / `413`。
- [x] 限制回环监听与精确 Origin；当前请求重新取得身份，GET/确认先核发起人；串行化同一任务确认。
- [x] 模型只读环境配置，移除自动密钥落盘；任务目录允许显式指向仓库外，持久化以原子写入且权限 0600 保存。
- [x] 依据当前后端补齐客户端身份、资源级回执 action 和 API 响应形状；结果未知不得换键或宣称完成。
- [x] 执行 `npm --prefix agent test`，要求原包用例及新增边界用例通过。

## 3. 前端接入

文件：`frontend/src/components/agent/AgentDock.tsx`、`agent-dock.css`、`AgentDock.test.tsx`、`frontend/src/layouts/AppLayout.tsx`、`frontend/vite.config.ts`。

- [x] 添加组件回归：服务断开可读错误、确认被拒仍可处理、会话更换不显示旧对话、关闭/Escape 与键盘输入。
- [x] 保留 Muse 预览字段与两段确认，使用现有 Sheet 管理焦点和关闭；状态如实显示，不把点击确认等同执行成功。
- [x] `VITE_AGENT_ENABLED=1` 时显示入口；代理只在本地开发服务中配置，发布默认关闭。
- [x] 运行组件测试、前端 lint、`tsc -p tsconfig.app.json --noEmit` 和构建。

## 4. 实机页面与文档

文件：现有 `docs/local-preview-acceptance.md`、`docs/frontend-pda-conventions.md`、`docs/verification-commands.md`、根 `package.json` 与 `.github/workflows/test.yml`。

- [x] 新建本任务独立 MySQL 测试实例与合成客户/商品，不使用其他任务实例。
- [x] 启动本任务后端、Agent 与前端，核对工作目录、回环地址和 API。
- [x] 使用独立命名 `agent-browser --session jixu-agent-local` 实测库存、权限拒绝、草稿预览/确认、简报及网络失败，保存截图；结束关闭并核验本任务浏览器会话。
- [x] `test:agent` 接入 CI；同步主题文档；审阅 diff，记录已验证与未验证层级。
- [x] 交付本地地址和实际评价；模型未配置时明确规则模式，未调用真实模型。
