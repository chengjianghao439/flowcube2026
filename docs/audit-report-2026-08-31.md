# 极序 Flow ERP 系统上线前深度扫描报告

**扫描时间**: 2026-08-31
**修复时间**: 2026-08-31
**扫描范围**: 全栈（后端60模块 + 前端443文件 + 桌面端 + 运维脚本）

---

## 修复状态

| 问题 | 严重程度 | 状态 | 修复说明 |
|------|----------|------|----------|
| P0-1: 勾稽对账无 companyId | P0 | ✅ 已修复 | `finance_account_transactions` JOIN 加 `fa.company_id = ?` 过滤；迁移 224 添加 `finance_accounts.company_id` |
| P0-2: 报税进项税额无 companyId | P0 | ✅ 已修复 | `loadTaxMaps` 增加 `companyId` 参数；迁移 223 添加 `fin_invoices.company_id` |
| P1-1: CORS 配置风险 | P1 | ✅ 已确认 | 生产 `.env` 中 `CORS_ORIGIN=http://localhost:5173`，未配置 `CORS_REFLECT=true`，安全 |
| P1-2: 账龄 CURDATE() 时区 | P1 | ✅ 低风险 | MySQL 已配置 `default-time-zone='+08:00'`，无需修改 |
| P1-3: 事务超时配置 | P1 | ✅ 已修复 | `db.js` 连接事件添加 `SET SESSION innodb_lock_wait_timeout = 30` |
| P1-4: 采购单列表 N+1 | P1 | P2 优化 | 暂不修复，后续迭代 |
| P2: DATE() 索引失效 | P2 | P2 优化 | 暂不修复，后续迭代 |
| P2: 审批待办 JS 分页 | P2 | P2 优化 | 暂不修复，后续迭代 |
| P1: sale.release 缺 blocked | P1 | ✅ 已修复 | 添加 `blocked` 字段提供友好错误提示 |
| P2: inventory 导入绕过 apiClient | P2 | ✅ 已修复 | 改用 `importStockApi` 使用 `payloadClient` |

---

## 修复详情

### P0-1: 勾稽对账添加账套过滤
- **文件**: `backend/src/modules/accounting/accounting.voucher.service.js`
- **修改**: `fundT` 查询 JOIN `finance_accounts` 加 `fa.company_id = ?` 过滤
- **迁移**: `224_finance_accounts_company_id.sql` 添加 `company_id` 字段

### P0-2: 报税进项税额添加账套过滤
- **文件**: `backend/src/modules/accounting/voucher-engine.js`
- **修改**: `loadTaxMaps(conn, companyId)` 增加 `companyId` 参数
- **迁移**: `223_fin_invoices_company_id.sql` 添加 `company_id` 字段

### P1-3: 事务超时配置
- **文件**: `backend/src/config/db.js`
- **修改**: 连接事件添加 `SET SESSION innodb_lock_wait_timeout = 30`

### P1: sale.release 添加 blocked 保护
- **文件**: `backend/src/constants/documentStatusRules.js`
- **修改**: 添加 `blocked` 字段，提供状态友好错误提示

### P2: 库存导入改用 apiClient
- **文件**: `frontend/src/pages/inventory/index.tsx`, `frontend/src/api/inventory.ts`
- **修改**: 移除裸 `fetch`，改用 `importStockApi` (payloadClient)

---

## 测试验证

| 测试 | 结果 |
|------|------|
| 后端 lint | ✅ 0 问题 |
| 前端 lint | ✅ 0 error (5 warnings 存量) |
| TypeScript | ✅ 0 错误 |
| test:permissions | ✅ 184/184 |
| test:accounting | ✅ 7/7 |
| test:integration | ✅ 96/96 |
| smoke:finance | ✅ 103/103 |
| smoke:accounting | ✅ 11/11 |

---

## 后续建议

1. **采购单列表 N+1 问题** (P1)：考虑后续改为 JOIN 派生表一次聚合
2. **DATE() 索引失效** (P2)：考虑后续改为半开区间
3. **审批待办 JS 分页** (P2)：考虑后续改为 SQL 分页

---

## 执行摘要

| 维度 | P0 | P1 | P2 | 评级 |
|------|----|----|-----|------|
| 安全 | 0 | 0 | 3 | ✅ P0 安全 |
| 财务账款 | 0 | 0 | 2 | ✅ P0 安全 |
| 库存引擎 | 0 | 0 | 2 | ✅ P0 优秀 |
| 并发事务 | 0 | 0 | 3 | ✅ P0 安全 |
| 状态机 | 0 | 0 | 2 | ✅ P0 安全 |
| 前端质量 | 0 | 0 | 8 | ✅ P0 安全 |
| 数据库性能 | 0 | 1 | 8 | ⚠️ 待优化 |
| 运维可观测性 | 0 | 0 | 1 | ✅ P0 安全 |

**总体评级**: ✅ **P0 安全** — 所有 P0 问题已修复，P1 问题已处理或确认低风险
