# 日常操作与履约优化 Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent backend task and review; execute the frontend work in this session. Steps use checkbox syntax for tracking.

**Goal:** 完成用户授权的第 1、3、4、6 项：降低大列表 DOM 和后台页开销，缩短履约更新等待，提高待办识别与筛选效率，并按职责拆分本轮涉及代码。

**Architecture:** 保留完整列表数据、无分页交互、权限与事务语义；仅对高频列表启用可变行高虚拟滚动，提取独立表格能力。履约采用提交后的合并刷新通知和有界异步处理，周期扫描兜底；列表查询与命令职责分离。待办复用已有接口与工作区，保存按用户隔离的视图，不新建业务入口。

**Tech Stack:** React / TypeScript / TanStack Query / TanStack Virtual，Express / MySQL，Vitest / node:test。

## 阶段 A：基线与工作区
- [x] 核实 main 干净，创建 codex/operations-optimize-20260912 专用工作树。
- [x] 按 lockfile 安装前后端依赖；执行 DataTable、履约相关既有测试。
- [x] 启动回环开发服务，使用既有本地只读账号，在同一浏览器会话记录商品、库存、销售页面的行数、DOM 数和切换耗时。

## 阶段 B：列表和多标签（对应 1、6）
Files: frontend/src/components/shared/DataTable.tsx；新建独立虚拟行 hook/表格布局模块；frontend/src/pages/products/index.tsx、pages/inventory/、pages/sale/index.tsx；相关 hooks/api；components/layout/KeepAliveOutlet.tsx。
- [x] 添加大数据只挂载可见行、滚到末行、全量选择、动态行高和隐藏再显示测试；先运行观察未实现的失败。
- [x] 使用真实可滚动祖先及行测量，原生 table 配上下占位行；200 行以上启用，保留表头、列宽/拖动、排序、行操作和导出数据。
- [x] 将列布局或虚拟行职责独立，避免继续扩展 DataTable 单文件。
- [x] 高频列表查询只在页面可见时活动，传递 AbortSignal；隐藏页面保持草稿和筛选，不做全局破坏式卸载。
- [x] 运行 DataTable/相关页面测试、类型检查；实测虚拟首尾行、选择、菜单、列拖动及返回位置。

## 阶段 C：履约更新与查询职责（对应 3、6）
Files: backend/src/modules/fulfillment/fulfillment.worker.js、fulfillment.service.js；新增刷新队列、查询/事件窄职责模块；相关业务提交完成入口；tests/fulfillment*.test.js；package.json/CI 仅按需要加入测试。
- [x] 先写合并通知、失败重试、处理中再次变化、回滚不触发、批量有界、周期兜底测试并确认失败。
- [x] 关键销售、采购、收货/上架、调拨、出库提交成功后通知；在事务外处理，相关销售供应依赖也刷新。禁止 GET 写入、事务内外部请求或改变业务事务。
- [x] 队列有界、单实例防重入、失败保留重试；保留原 30 秒游标扫描作丢通知/重启兜底。提供最近成功/失败、积压与耗时诊断，避免后台失败静默。
- [x] 从 service 提取列表查询及事件公共职责，保持导出兼容；列表有界 JOIN 业务单号/往来方/仓库，保留原权限及跨仓防泄漏。
- [x] 离线测试及隔离数据库 smoke:fulfillment 通过。

## 阶段 D：待办效率（对应 4）
Files: frontend/src/components/shared/FulfillmentTodos.tsx、frontend/src/api/fulfillment.ts；新增视图 hook/测试；现有工作台和订单详情消费者。
- [x] 添加业务单号展示、关键词/类型/状态筛选、用户隔离视图恢复、隐藏页请求停止测试，先确认失败。
- [x] 显示业务单号及往来方/仓库识别信息，保留旧数据无单号的诚实回退。
- [x] 提供关键词及单据类型筛选，原状态筛选保存为用户个人视图；KeepAlive 返回时保留位置，不把完整数据或业务信息持久化。
- [x] 跟进操作保留原单权限、负责人/version/请求键规则，命令成功后刷新相关待办查询。

## 阶段 E：文档、评审与交付
- [x] 立即更新 AGENTS.md 第 7/9 节及列表、履约文档；记录实际范围与运行限制。
- [x] 按顺序完成需求覆盖评审、代码质量评审，修复发现的问题。
- [x] 前后端 lint、app TypeScript、前端测试、ERP/PDA 构建、相关后端离线/隔离数据库回归。
- [x] 本地开发页面验收，记录同口径前后数据，关闭并核对本任务浏览器资源。
- [x] 检查 diff；仅本任务路径提交（提交前列文件用途），不推送、不发版。主开发目录及其他工作树保持原状。

## 明确边界
第 2 项生产备份/清理政策与第 5 项真机/承运商正式验收不在本轮。第 6 项按用户接受的渐进方式，先拆本轮实际触及的表格及履约服务；不一次改写销售事务及打印编辑器。性能目标以同机器、相同数据、相同页面操作对照为准，不把单测或构建当真实页面验收。
