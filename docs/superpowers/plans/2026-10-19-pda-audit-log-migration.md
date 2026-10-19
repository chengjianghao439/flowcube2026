# PDA 审计日志正式迁移实施与验收计划

基线：`bd011c1db9a9c14a08fc786e7836ed5f68596eac`，本轮核得 292 份 SQL、最大编号 292；293 在该基线空缺。计划只覆盖 PDA 日志表，不包含关联历史权限补丁。验证结果单独记录，不预填生产或设备通过。

## 实现边界

1. 新增 293，所有已有迁移保持原字节。两表完整元数据预检、失败守卫必须先于任一 CREATE/ALTER；只接受已知表/列/主键/索引/约束形状。同名索引不只核名字，还核完整列序与属性，未知漂移 fail-loud。
2. 新表沿原 signed INT、VARCHAR、DECIMAL(10,2)、nullable TIMESTAMP DEFAULT CURRENT_TIMESTAMP。旧表仅转换已知 utf8mb4 排序规则、补缺失具名索引，保留列/表注释、原值和高自增位置；各已知半途 DDL 状态可重入。
3. scan-logs service 只删除四条请求期建表查询，保持原写入字段、缺表/报表降级、logUndo 的数量检查位置；schema-reconcile 移除两张 runtime 豁免。180 天清理和业务数量策略保持。
4. 原 ephemeral runner 新增独立命名 PDA 模式，保留本机 Unix Docker、完整实例归属、非共享端口与精确清理。只用缓存镜像，不读真实 backend/.env，不启动应用/GUI，也不串入其它业务 suite。

## 验收与反向证明

- 离线：真实 service/迁移/分句模块，显式 stub DB/env；先核原树与上传 SQL 的失败反例，再核候选。新增三个脚本别名须在 CI 可达，PDA suite 不能被前面的其它分支截获。
- 专属 MySQL：先完整迁移当前目录；之后仅重置本批实例两张日志表及 293 测试回执。每次写前重新验归属，测试重置不作为运维回退示例。
- fresh、原 runtime legacy、缺一表、两表任一异形、视图、signed/precision/null/default/EXTRA/列序/引擎/排序规则/主键/索引/未知约束，拒绝时逐项比两表结构/行和 ledger 未变。
- Unicode/NULL/原两位小数、HEX/UNIX_TIMESTAMP、AUTO_INCREMENT、既有注释迁移前后相同；实际迁移连接分别 SET/读回 UTC 与 +08:00。主键反例独立观察索引谓词，不能让列拒绝掩盖索引检查失效。
- CREATE/CONVERT/ADD INDEX 后各中断一次，由真实 runMigrations/ledger/error 路径重入；最终完整回放跳过原回执。
- 原数量回归、迁移分句/触发器守卫、runner 归属/CI 可达与受影响 lint 需在最终工作树复核。共用函数/路由契约的发版前全量规则仍有效；本轮不发布。

## 交付与待验

代码与 `docs/backend-api-sql-conventions.md`、`docs/verification-commands.md` 同批提交到用户指定 `fix/pda-audit-logs-293` 新分支，创建 base main 的 draft PR；不推 main、不合并、不部署。最终报告区分候选验证与原树复验，记录红绿日志、独立审阅、精确文件清单和临时资源清理。生产两表实际元数据、正式迁移、PDA 真机/扫码及物理出纸独立待验；关联历史权限仅保存允许的静态结论，不应用或运行受阻补丁/探针。

## 2026-10-19 独立 PR 执行补充

- [x] 远端 main 实核等于 bd011c1，指定新分支此前不存在；原树保护。原生工作树工具不支持当前任务类型，回退 git worktree，分支 fix/pda-audit-logs-293。
- [x] 仅迁入本轮14路径，唯一新增迁移293，原迁移不改；只复用已装且锁文件相同的依赖，不安装软件。
- [x] 新增三条合成历史记录，真实SQL与原异常报表同时核内容/计数/时间/可见性，不能据用户提供的生产3条信息宣称已查生产。
- [x] 本分支重新执行静态/单元/前端lint、正确tsconfig类型检查、ERP/PDA构建及全目录独立迁移/PDA重入；旧72/39不计本轮结果。
- [ ] 按AGENTS精确路径暂存、提交、仅推此新分支，创建base main的draft PR。全部同最终SHA适用GitHub检查通过后再报告第一项候选结果。
- [ ] 不合并、部署、触发发布workflow或访问正式服务器。第一项全绿后才处理第二分支；旧安全拒绝不由新任务自动解除，不能建空完成PR。

本轮本分支候选自测：84项本地命令退出0（含前端385文件/3483用例），PDA专属实例40/40且本批资源清理确认；基线只读反证5通过/3预期失败，当前离线8/8。以上不代替尚待取得的同SHA GitHub完整矩阵、用户独立验收或生产/真机验证。
