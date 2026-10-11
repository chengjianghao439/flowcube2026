# 极序 Flow 允许范围收尾计划

> **For agentic workers:** Use the existing authorized worktree and execute inline; the user owns final acceptance. Do not commit, switch branches, or run the blocked relatedEvents reproduction or repair.

**Goal:** 修复两项已复现检查失败，并补齐独立合成浏览器验收、残留资源与硬件验收交接。

**Architecture:** 沿现有恢复、虚拟列表、焦点及打印幂等实现。只替换用户可见术语；八位换算率显示集中到 format.ts，数量仍为两位。VM 夹具显式补齐新增依赖，未知 require/SQL 守卫和原断言保留。

**Tech Stack:** Node 22、React/Vitest、agent-browser、专属 MySQL 8 Docker 实例。

## 1. 接手保护与资源
- [x] 保存3702安全路径哈希、工作区状态、原WIP差异和13路径清单到外部证据目录。
- [x] 复现 copy-conventions 的10处和 purchase-return-lock-budget 的17处加载失败。
- [x] 核验残留实例标签、卷、runner与监听；保存归属、日志及响应副本。
- [ ] 不可恢复删除仅在用户确认精确对象后进行；没有确认时保持。
- [x] 不修改 document-activity.service.js 等受阻修复文件，只记录现状；未运行受阻复现或相关专项。

## 2. 文案与显示
Modify: useInboundTaskCreateRecovery.ts、useInboundTaskEditRecovery.ts、printReprintIntent.ts、inbound detail.tsx/inboundException.ts、inbound-tasks.edit.js、PurchaseQuantitySummary.tsx、format.ts及受影响测试。
- [x] 用户文案中“回执”改“结果”，“容器”按本域改“库存条码”；保留原条件、错误码和恢复协议。
- [x] format.test.ts先增加 unitConversionRate 的八位小数、千分位、无效值用例并确认缺函数失败。
- [x] format.ts新增 unitConversionRate；PurchaseQuantitySummary 复用它，qty不变。
- [x] 同批更新上架异常的原渲染文案断言。
- [x] npm run test:copy-conventions、相关Vitest、tsconfig.app.json检查。

## 3. VM夹具
Modify: tests/purchase-return-lock-budget.test.js。
- [x] 显式提供 reprint-source/reprint-intent、inbound create-receipt/edit-rules与purchaseOrderStatus依赖。
- [x] 使用真实纯函数依赖；未覆盖的补打入口调用时明确失败，不给默认成功结果。
- [x] npm run test:purchase-return-lock-budget：30/30；没有放宽断言。
- [x] 保留修前、修后日志及最小补丁。

## 4. 浏览器
- [x] 专属合成实例启动前及每个场景前核活runner、标签/卷、端口、UUID和时间窗口；不复用残留实例。
- [x] 会话flowcube-closeout-20261011；正常表单登录，先验证应用连续可显示和交互。中途会话丢失另记，未宣称全程稳定。
- [x] 未知结果：只丢弃本次真实已处理响应；查询原结果、检查原键与任务数量。
- [x] 过期：只把本次合成请求时间设为真实七天外，后端正常响应；不伪造接口或改浏览器时钟。属于受控持久状态夹具，未自然等待八天。
- [ ] 焦点与返回位置全部最终复验：轮询/503/行消失焦点已通过；返回位置修前偏移66px、修后一次往返保持，最后重复打开详情未获得可靠证据，待验。
- [x] 保存截图、请求/任务计数、每项结论及限制；结束精确关闭本会话，确认会话列表为空；本轮自建容器/卷/服务/凭据文件已清理。

## 5. 交付
- [x] 对应主题文档同批记录实现边界。
- [x] 输出相对接手基线的准确文件/补丁；3702路径中仅本轮17处改变，3685处不变，13处P1快照一致，暂存区为空。
- [x] 准备PDA、Electron与实际出纸最短操作清单；业务待决策项只记录。
- [x] 用户最终验收前不称整批通过，不提交/推送/部署。
