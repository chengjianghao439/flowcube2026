# 手动离线应用发版实现计划

> 执行方式：按用户已批准方案，在本任务独立 checkout 内完成；不操作服务器、Secrets、环境或旧 PR。

**Goal:** GitHub 标准 runner 构建后直接经受限 SSH 交付，网页/PDA 只有显式人工触发入口。

**Architecture:** 目标解析及 GitHub 门禁、无秘密构建、fresh 发布 runner、服务器固定接收器/执行器四层隔离。GitHub OIDC 签名把完整包摘要与已审核工作流版本、人工触发者/run/attempt 绑定。服务器离线验签，固定 Compose 组合及数据库锁文件保持；失败停止，人工从备份恢复。

**Tech Stack:** GitHub Actions、Node 22、Python 标准库、OpenSSL、OpenSSH、Docker Compose。

- [x] 核实 main、PR 95/96 文件及所有触发器，记录分支推送安全性。
- [x] 先写完整包校验、JWT 验签、状态/重复/锁与 SSH 越权行为测试并确认失败。
- [x] 实现 `scripts/manual-release/{protocol,receive,make-bundle,send-bundle}.py`；使用临时合成包验证，不连接生产。
- [x] 网页/PDA workflow 改为 dispatch；构建与发布分 job；可信工具固定 workflow SHA；测试和 audit 必须由 GitHub API 证明。
- [x] `server-update.sh` 保留镜像/备份/健康/停写门禁，删 Git 更新、参数更改、首次 MySQL 启动、自动回滚、cron；旧 Mac 串联入口明确拒绝。
- [x] 更新发版相关契约测试、运维主题文档、技能；测试反例包含篡改、路径穿越、链接、注入、重复/并发、失败无回滚、非人工触发。
- [x] 最终差异审阅、离线测试、actionlint及只读独立代码审阅。
- [ ] 仅推新分支并建 draft PR；核实远端 SHA 与每项 CI 终态（以PR及交付报告记录，未触发发版）。

## 已核实事实

- main `8db3e40f22e3949b50d1d698086c1a9cac2c183f`；#95/#96 merged。
- #96 仅修改前端锁文件、离线维护预检和该预检测试；没有修改 release-gate/server-update。
- 原网页/PDA 仅 main push/dispatch，桌面 push main/v*；当前没有 workflow_run 串联。推新 `codex/` 分支不发布，PR 只触发测试/安全扫描。
- 不把旧数据库离线工具的白名单作为本流程身份或安全证明。
