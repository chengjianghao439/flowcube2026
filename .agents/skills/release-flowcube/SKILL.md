---
name: release-flowcube
description: 极序Flow网页/PDA手动离线发版约束与独立桌面发布指引；读流程和改代码不构成生产授权。
---

# 极序Flow发版

先读 [AGENTS](../../../AGENTS.md)、[运维主题](../../../docs/print-deploy-ops.md)、[手动发版运行手册](../../../docs/manual-release.md) 及现行workflows。

当前用户要求优先。仅开发/PR任务不得发布、合并、登录或探测正式服务器。本次新流程代码不等于运维已安装或已上线。

网页/PDA顺序固定：运维实际备份并问老大 → 老大本人在GitHub同一审批issue回复“发 + 完整SHA”并手动触发 → 发布 → 运维检查 → QA真浏览器按清单人工验收。评论绑定数字身份、SHA和先后顺序；任意“已批准”输入不算授权。实际备份/恢复演练是运维门禁，不能由评论或CI绿灯冒充证明。

只接受main历史中的完整40位SHA。GitHub API验证同SHA Tests/Security和四项实际npm audit步骤。网页/PDA仅workflow_dispatch，无main push、工作流串联或旧Mac后门。构建无部署秘密；fresh发布runner验整包来源后才使用专用新key/OIDC，经固定receive-v1命令传整包。没有本机代理中转依赖。

服务器只使用运维预装、受审版本的接收器与固定执行器，保留真实Compose组合及数据库版本锁。迁移只来自目标镜像；不git pull/npm install/docker pull、不升级引擎/改参数/cron。失败就停，无自动回滚，运维用已批准备份恢复。重复SHA/版本/attempt、篡改、越权命令均拒绝；未知结果先核实，不盲重试。

版本与说明按既有三端/PDA同步规范准备；代码修复、版本准备不构成发布授权。桌面Windows安装包仍按 [RELEASE](../../../docs/RELEASE.md) 的独立tag/手动构建规范，不自动触发网页/PDA。

账号、新SSH key、指纹、环境/Secrets、强制命令、sudoers、OIDC公共信任、服务器演练全部交运维按手册另行审批配置。新key验证成功后先列旧key用途清单，再等老大单独批准停用，不自动删除。

老大或运维说停：不再发送任何命令（包括补查）；报告最后命令、准确时间和在途状态。

交付分开报告代码/提交/推送/CI/部署/运维检查/QA/真机状态。自动smoke不能写成QA验收，未执行的明确标待验。
