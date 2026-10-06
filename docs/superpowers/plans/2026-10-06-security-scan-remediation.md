# 安全扫描整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 核实并处理扫描 df58b533 的全部27项，保留可复查的红绿回归与未部署边界。

**Architecture:** 基于14e97aa的隔离工作树，按请求入口、资源授权、会话与导入、打印、发布供应链划分。权限在原事务锁和幂等回放前执行；构建与发布凭据分离，发布目标只能是受信主线提交。

**Tech Stack:** Express/CommonJS/MySQL8、React/TypeScript、Electron、GitHub Actions。

扫描原始报告：`output/security-scan-2026-10-06/findings.json`，编号为数组顺序。main及其他工作树保留，暂存与提交由root最后按明确路径处理，不推送、不发版、不在云端关闭尚未部署的问题。

## 任务与验收

- [x] 请求入口（root）：#1/#4/#9。文件 `backend/src/app.js`、`middleware/auth.js`、`middleware/opLogger.js`、`modules/auth/auth.controller.js`、`modules/auth/auth.routes.js`、新 `middleware/apiIngress.js` / `utils/trustedProxy.js`、`docker/Caddyfile`。先以真实Express HTTP验证超额畸形JSON返回429而非解析400，未认证写入不执行operation_logs SQL，两个公网地址产生不同req.ip且不信任公网直接调用者的伪造XFF；保留已认证操作意图预写及失败阻断业务语义。
- [x] 资源授权（scope_security）：#2/#7/#8/#11/#12/#16/#17/#27，对应return-tasks/approvals/packages/stockcheck/search/reports/export/logistics/finance/inventory。限仓用户不能读或变更他仓；绑定A设备不能对B执行，空范围为空；费用非本人无view_all拒绝；搜索每类沿原canonical view/owner/company规则；分页复用normalizePagination。SQL桩红绿后使用独立测试库验证实际查询。
- [x] 会话与导入（session_import_security）：#10/#13/#20/#22/#23。auth/users/import模块及幂等新增迁移276。轮换token共享family，新access绑定会话，复用旧token撤销后继，退出即时撤销当前设备且保留其他会话；禁用递增epoch与作废会话同事务。账号不存在/禁用/错密码公开响应一致。导入在写入前限制ZIP解压与解析预算，在受限worker内解析并设并发/时间/内存界限。
- [x] 打印（print_security）：#6/#14/#15/#18/#24与#16打印分页。printers/print-jobs/print-templates、Electron IPC/preload、前端打印bridge与模板renderer、迁移277。随机可撤销凭据绑定claim/ack，公开code不得身份替代，管理及统计完整scope；ZPL单份及展开字节预算服务端与main复核；私有临时目录exclusive创建并finally收尾；模板元素/列/单元格预算明确拒绝。
- [x] 发布供应链（root）：#3/#5/#19/#21/#25/#26。两个构建workflow、security-scan workflow、Dockerfiles/Compose、Gradle wrapper、trusted release target脚本与NSIS校验helper。先用临时git仓库反例验证任意branch被拒、主线历史SHA可用；构建只读runner没有发布密钥，发布在fresh job并重新核immutable SHA/artifact来源；PDA在fresh signing job运行官方工具，不把密钥给Gradle。Gitleaks精确选择单实现且镜像digest/source只读无token；NSIS提取前sha256；基础image及Gradle digest从官方来源核验。
- [x] 集成（root）：为新测试接package.json与Tests CI，主题文档同批同步；按spec→quality独立复核所有项；相关离线回归、backend/frontend lint、app类型、ERP/PDA构建，以及专属测试库真实HTTP/SQL验收。新守卫须证明恢复原缺陷会红。实际GitHub Actions、真机、纸张和生产状态另记待验证。

## 执行记录

2026-10-06：从当前Chrome页面及Security Cloud connector读取全部27项；扫描与main均14e97aa。用户明确授权三个子代理并行，工作树与依赖已准备。原始证据包含静态分析限制，不能当生产漏洞已实测。完整迁移及276/277幂等/schema专项、真实HTTP/SQL、受影响回归已在新建独立测试库验收；独立复审追加问题已修正。发布/中转兼容性24/24与整批离线102/102、最终数据库3/3及打印11场景已通过，根代理统一复核diff和提交范围。未推送/发版，真实CI、安装包、Caddy、设备与物理打印单独待验，不在云端关闭问题。完整证据见 `docs/security-scan-remediation-2026-10-06.md`。
