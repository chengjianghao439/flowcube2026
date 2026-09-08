# 德邦直连准备实施计划

> 按 writing-plans 记录并在当前会话逐项执行，沿用用户“现在实现德邦快递”的授权；保留其他任务及前一轮删除入口的改动。

**目标：** 复用既有德邦适配器，补齐用户此前提供的测试入口和生产配置传递，完成官方允许范围内的真实联调；权限和凭据不足时明确记录待办，不把离线测试当作正式下单通过。

**实现：** 仅在 sandbox 模式精确允许已提供的创建与原单查询 HTTP 地址；生产仍要求官方 HTTPS。Docker 将德邦默认凭据组注入 backend，前端不接收。签名、月结与接入编码分离、请求固化后仅查询、30 箱分批保持现有实现。

**技术：** Node/CommonJS、原生 node:test、Docker Compose、现有德邦官网会话。

- [x] 在 `tests/direct-express.test.js` 增加指定 HTTP 测试地址按用途通过、用途互换/其他路径/生产模式拒绝的回归；先运行确认旧校验器导致失败。
- [x] 修改 `backend/src/modules/logistics/carrier-adapters/direct-common.js`：`endpoint(value, platform, mode, lookup)` 依据创建/查询角色，精确匹配此前分配的两条 HTTP 沙箱地址；`credentials` 传递 lookup。其他官方 HTTPS 校验保持严格。
- [x] 在 `docker-compose.yml` 的 backend.environment 添加 APP_ID、APP_KEY、MODE、API_BASE、QUERY_API_BASE、ORDER_PREFIX、VERIFIED_MONTHLY_ACCOUNTS 的 `WAYBILL_DEPPON_MAIN_*` 映射。根 `.env.example` 记录正式配置字段，backend 样例记录测试入口适用环境和用途。
- [x] 同步 `AGENTS.md` 第 8 节与 `docs/direct-express-2026-09-06.md`，明确配置与实际开通边界。
- [x] 运行 `npm run test:direct-express` 与受影响后端 ESLint；使用 `/dev/null` env 文件、虚构必填变量运行 Docker Compose config，断言德邦七项仅注入 backend。检查 diff。
- [x] 用户完成德邦登录后，读取现有接入/接口/测试配置，确认客户订单号查询及正式权限；不重复注册或把月结号误当 companyCode。需要本人验证码时交由用户完成。
- [ ] 取得对应环境凭据后先执行真实原单查询，再按正式/沙箱权限安排下单验收。正式订单须具有经用户确认的实际业务资料；不得用生产测试库或虚构资料发货。同步实际结果与剩余限制，关闭本任务浏览器资源。

执行结果：前六项已完成。最后一项已完成只读查询、真实沙箱对照联调与结果记录；正式开通/多箱验收仍依赖德邦提供生产配置和确认产品及子母件权限，不标记为全部完成。详见 `docs/deppon-onboarding-2026-09-09.md`。
本任务调试会话已停止并核验，不影响其他任务会话；正式验收仍未完成。

续办：使用用户原月结账号完成独立测试环境 XJTK/DJTK 两箱对照，均只有一个号。官网已通过本地联调，并成功提交无面单照片的人工上线审核；等待德邦对接人起草工作流及核对子母件处理，未启用生产。
本轮收尾：已关闭遗留临时文档标签，停止调试会话并核验，保留用户官网登录页。最早测试单约 25 分钟后原单查询仍只有一个号，已记录供德邦核对。
