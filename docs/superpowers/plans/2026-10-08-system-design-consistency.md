# 极序 Flow 全系统设计一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. 当前用户已授权持续实施及独立模块并行审查。

**Goal:** 建立完整界面清单，以真实隔离页面证据确定设计基准，修复同语义差异并完成分批回归与复验。

**Architecture:** 复用现有 PageHeader、DataTable、AppDialog、Finder、状态和恢复体系；公共组件集中修改，单页保持真实业务差异。真实 API 使用既有专属临时实例归属门和合成夹具，不加载项目真实 .env。

**Tech Stack:** React、TypeScript、Vite、Tailwind、Radix、Vitest、Node 22、MySQL 8、agent-browser。

- [x] 核验基线 66fa87e、干净主目录，创建独立工作树，安装锁定依赖。
- [x] `scripts/design-audit/inventory.mjs` 枚举 ERP/PDA 路由与每个页面下弹窗/选择器/状态调用，输出 `docs/design-audit-2026-10-08/coverage.json` 和 Markdown。
- [x] Assessment A/B 分别独立完成设计语义与技术审查；浏览器在真实合成数据页面补证据。
- [x] 按 `repair-smoke-ephemeral.sh` 现有边界创建本批实例，通过 `scripts/design-audit/runtime.cjs` 运行合成 API，不起 scheduler；保存原始截图和操作记录。
- [x] 以已有最佳模式建立设计基准和优先问题清单，保留数量/金额精度、身份字段、业务阶段与原操作核对。
- [x] 首批公共模式先写必要行为回归，确认自然失败，再实施；相同数据、尺寸、主题、状态复验通过后推广。
- [ ] 九大领域清单与逐项实际查看/修改证据已登记；全页面/表面七态尚未验完。145路由记录、56代表细看、44限定交互；动态合法阶段、撤权/pending/unknown及硬件边界按剩余清单续接，不将部分完成勾成全验收。
- [x] 运行全前端单测、lint、`tsc -p tsconfig.app.json --noEmit`、ERP/PDA build、受影响项目守卫。检查每个调用方及多标签草稿/取消/重开。
- [x] 对最终变更做独立代码审查；更新主题约定与交付证据。只保留本地代码，不推送/发布/部署。
- [x] 关闭任务浏览器并核对 session list；结束本批 API 和实例，核对精确资源清理；保存明确续接点与未验证项。

## 本轮保存与续接

交付入口为`docs/design-audit-2026-10-08/README.md`，验证为`verification.md`，明确尚未完成的工作为`remaining.md`。17类问题已实施，最终全前端260文件1877用例、类型、lint0错误37警告、两端build、15相关守卫通过。独立审查没有新增P0/P1。浏览器/两个API/Vite退出，专属实例容器卷删除，共享3307健康；细粒度打印helper401失败与外层资源清理确证分别保存。没有提交/推送/发布/部署或生产/硬件验收。
