# 销售开单异步查价保护

销售新建、编辑与改单共用的状态和事件已从 `frontend/src/pages/sale/form/index.tsx` 提取到 `useSaleOrderForm.ts`。已有初始化、脏状态、选品、数量聚焦、折扣计算和返回接口保持，新增行级 `priceErrors` 供视图校验和提示使用。

## 当前行为

- 明确选择客户仍重新查询所有已选商品，包括之前手动定价的行。查价绑定行 key、客户 ID、商品 ID 与本次请求身份；快速切换客户或商品的旧响应不再回写。
- 价格请求开始即清除旧 `resolvedPrice` / `resolvedPriceLevel`。`priceLoading` 仅由当前请求完成、当前行手动确认或删行清理，旧请求完成不能清掉新请求的等待状态。
- 用户在请求途中手动改价，立即取消该行旧请求的回写资格、清理错误并结束等待；后续再明确选择客户会重新定价。
- API 查询失败、返回空值、非有限值或非正单价时，该行进入待确认状态。显示数值可以保留供核对，但不代表当前客户已确认定价；表单须阻止保存，并提供手动输入或“确认当前单价”入口。手动确认调用现有 `updateItem(key, 'unitPrice', value)`；值本身仍须满足销售单价校验。
- 删行清理价格状态与请求身份。卸载清理所有请求身份及待执行聚焦计时器；迟到响应不再更新。
- 商品单位请求独立于价格请求，手动改价不会丢弃合法单位响应。选品版本保护切换商品后再切回同一商品的情况；编辑初始加载也不能覆盖重新选品后的单位。
- 请求从用户事件中发起，不再藏在 `setItems` 更新器中，React StrictMode 不会因此重复发起客户重定价。

价格等待和待确认提示属于前端状态，不增加后端字段，不改变服务端价格权限、计量单位折算、订单事务或幂等规则。新建/编辑/改单的集中校验由同批开单提效改动接入；总体说明见 `docs/order-entry-efficiency-2026-09-12.md`。

## 回归依据

Node 22 下执行：

```bash
npm --prefix frontend run test:unit -- src/pages/sale/form/useSaleOrderForm.test.tsx src/pages/sale/form/index.test.tsx --maxWorkers=1
cd frontend
./node_modules/.bin/eslint src/pages/sale/form/useSaleOrderForm.ts src/pages/sale/form/useSaleOrderForm.test.tsx
```

结果：20 个 hook / 真实 Finder 联动测试及 3 个原页面测试通过；针对性 ESLint 无问题。受控 Promise 最初复现旧客户/旧商品覆盖、手改覆盖、loading 提前结束、删行残留与 StrictMode 重复查询等失败；修复后通过。编辑初始单位旧响应覆盖也单独先复现再修复。另覆盖空白新建页经真实 ProductFinder 单击选品、确认并关闭弹窗后的回填，避免仅直接调用 hook 而漏掉组件事件联动。

完整 TypeScript、全量前端测试、ERP/PDA 构建及本地浏览器检查以主任务集成后的实测记录为准。本专项没有运行数据库测试、真实保存订单、生产访问或设备验收。
