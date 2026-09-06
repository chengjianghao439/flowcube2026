# 快递账号管理优化

承接已确认的单页新增、修改、暂停、解绑与删除需求。在当前工作区继续既有未提交实现，不覆盖其他任务，不发布、不调用快递生产接口。

1. 先扩展 `tests/carrier-account-binding.test.js`：解绑保留承运商及凭据引用，已启用/待处理/旧 revision 拒绝；删除已绑定、已启用或有关联销售/运单/运费业务时拒绝，仅空记录软删除。新增账号默认暂停，按请求键重放。
2. `carriers.binding.js` 增加事务内 create/remove/unbind。新增 POST `/api/carriers/account-bindings`，严格中文名称/平台/月结资料 schema，复用创建权限和 operation_requests；解绑复用 PUT action=unbind、编辑权限和 revision；普通承运商删除复用同一保护。
3. `/carrier-accounts` 改为可搜索账号列表与详情编辑区，新增内联表单只采集名称/平台/月结号；支持已有未绑定承运商，删除和解绑使用已有 ConfirmDialog。仓库人员不填技术凭据；保存、暂停、解绑后刷新状态。列表使用 collectAllRecords 有界加载，只查询选中账号状态。
4. 交互测试覆盖新增请求、无权限、解绑确认及取消、失败提示、选择切换。执行 Node 绑定回归、Vitest、lint、tsc，再用本地开发服务验收。数据库验证只在独立测试库执行；不修改真实账号或发送真实快递订单。
5. 同步 AGENTS.md 第8节和 direct-express 文档。检查 diff，记录真实验证结果及生产未发布边界。关闭本任务浏览器会话。

实施完成：42 项离线回归、7 项前端交互测试、独立 MySQL 烟雾回归、真实 HTTP 严格参数检查、Vite 开发模式界面操作及 1280/720 布局验证、类型检查、受影响 lint 与 ERP 构建均通过。AGENTS.md 和接入文档已同步。未提交/发布，自动发货未启用。
