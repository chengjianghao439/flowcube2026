# 标签打印软件问题修复计划

**目标：** 修复 LP-01–07 的软件缺陷，保留无实体打印机的验收边界，不发布。
**实现：** 队列继续事务入队及客户端单消费；失败回执绑定领取令牌，路由保留仓库和用途边界，ZPL 字段统一清洗并下发画布纸高。任务多份组装为一次 RAW 提交，模板有份数指令时不叠加。
**环境：** Node 22 / CommonJS、MySQL 8 独立测试库、React/TypeScript/Vitest。隔离工作树修复，最后按已审查路径回填主目录，保留所有其他任务改动。

- [x] 任务 A：ZPL 字段安全和纸高（LP-04/07）。先在 tests/label-zpl.test.js 增加 ^/~、控制字符、替换字面量及 50/75mm 高度断言，观察旧实现失败。修改 labelZpl.js 和 print-jobs.template.js，统一清洗并用单次回调替换变量，生成 ^LL；不修改几何镜像，保留203dpi。运行 npm run test:label。
- [x] 任务 B：队列与路由（LP-01/02/03/06）。新增 tests/print-queue.smoke.test.js，校验测试环境并用 prepareSmokeContext 创建独立虚拟打印机；旧 token失败回执、缺token、过期领取、无绑定面单、跨仓环境兜底必须被拒，当前token完成/失败和本仓合法路由仍成功。先观察失败，修改 command/controller/dispatch/label-command，claim只返回CAS成功记录，同步mainline回归请求。运行 npm run smoke:print-queue。
- [x] 任务 C：多份与桌面消费（LP-05）。新增 DesktopPrintClientBridge.test.tsx，直接通过实际组件覆盖 printJobContent（不重复编写镜像断言），先证实3份只提交1个格式、失败不传token，再实现有界1–100整数份数校验及单次RAW批次拼接。copies=1 保留历史模板；copies>1且模板含^PQ则报明确冲突，不静默放大。成功回执失败不改报打印失败，错误上报包含本轮token。后端入队拒绝非法copies。
- [x] 任务 D：验证及回填。独立规格审核后做质量审核；运行标签/打印纯规则、队列专项、历史清理、主链、前端相关/完整单测、类型检查、lint和ERP构建。将测试入口加入现有Tests CI，同步AGENTS.md、模块README与原审计报告的现行状态，保留修复前JSON证据。回填前核对主目录目标文件没有新增其他改动，保留专用工作树记录，不覆盖其他任务。

数据库测试只连接新建 flowcube_printfix_*_test，经 tests/helpers/testEnvironment.js 校验；下载目录设置到本任务/tmp路径。完成后移除本次测试库，不调用物理打印接口。真实设备出纸、中文字体、纸张校准和扫码留待接设备。
