# v0.9.10 发布验收（2026-09-08）

发布提交 `b1f8b0a6976ba783052a40253a642516409a9870`，tag `v0.9.10`。网页、后端、Windows 与 PDA 版本为 0.9.10，PDA versionCode 118。

## 范围与验证

本次包含客户/供应商往来明细、现结/月结入口区分、按单登记默认全部日期未结清、财务单位归属与采购来源保护、页内标签状态保留、巡检待办下线、列宽恢复按钮移除及首页卡片全局排序。官网更新摘要、版本说明、AGENTS 与对应实现文档同步。另一任务的快递 HTTP 联调代码、测试和说明未纳入发布，逐文件摘要及 AGENTS 段落确认完整保留。

- 前端 44 文件 / 216 测试通过；独立发布工作树再运行同一套测试通过。TypeScript、ERP 与 PDA 构建通过。
- 两端 lint 无错误；前端保留 5 条既有 react-refresh 导出警告。
- 后端工具/部署/财务采购守卫等 67 项纯回归通过。
- 本机独立 `flowcube_repair20260908_test` 库：往来明细 17 项、默认未结清 5 项、应收修复与扫描 13 项、采购修复 8 项通过；财务全链路 108 项通过。未在生产执行这些测试或重复运行历史修复 apply。

## 同一提交的云端工作流

| 工作流 | 运行 | 最终结果 |
|---|---|---|
| Build Desktop Installer (v0.9.10) | [34213010677](https://github.com/chengjianghao439/flowcube2026/actions/runs/34213010677) | success |
| Security Scan (main) | [34213005331](https://github.com/chengjianghao439/flowcube2026/actions/runs/34213005331) | success |
| Tests (main) | [34213005181](https://github.com/chengjianghao439/flowcube2026/actions/runs/34213005181) | success |
| Build Desktop Installer (main) | [34213005291](https://github.com/chengjianghao439/flowcube2026/actions/runs/34213005291) | success |
| Build PDA APK (main) | [34213005358](https://github.com/chengjianghao439/flowcube2026/actions/runs/34213005358) | success |
| Deploy Browser App (main) | [34213005177](https://github.com/chengjianghao439/flowcube2026/actions/runs/34213005177) | success |

网页与 PDA 在第二次运行成功，原因和处理见下节。Windows 正式包来自 tag 触发的 Windows runner。

## 生产结果

- 发布前完整数据库备份通过 gzip/建表内容校验，保存在服务器受限目录 `backups/release-v0.9.10/flowcube_20260908_175858.sql.gz`，SHA-256 为 `e894a7d280682339e16ce8408a57b5db6b1d48af139c38dd33b2ffb984d9c309`。这是服务器本地备份，不冒充异地备份验收。
- 服务器 Git HEAD、前端与后端镜像 OCI revision 均为上述完整发布 SHA；服务运行正常，公网 `/api/ready` 返回 ready。
- 238、239、240 三份迁移及 4 个往来记账触发器完整生效；`log_bin_trust_function_creators` 恢复为迁移前的 0。
- 生产只读事务对全部单位的往来明细净额与现有账款净额核对，差异单位数 0；当前启用结转 3 条。客户/供应商样本调用真实明细服务成功。此检查不能替代启用前历史流水，也不伪造旧流水。
- 官网显示本版摘要、Windows 下载指向 0.9.10；ERP 登录页正常，无捕获到的浏览器脚本错误。已登录页面、受限权限及对账单回跳均通过正式生产门禁。
- `/latest.json`、`/api/app-update/latest` 均为 0.9.10。实际下载 Windows 文件 112,339,851 字节，SHA-256 `701c250f61b744e897b41317803937991e452b160857615e122aafde855c7b1f`，与更新清单及 GitHub Release digest 一致。
- `/api/pda/version` 为 0.9.10 / 118、available=true。实际下载 APK 15,013,815 字节，SHA-256 `0bfe00e3017cfcb14437857ac827e5617a7a2152172f86aa3e79188e1b8878d4` 与清单一致；aapt 实测包名 `com.flowcube.pda`、versionName 0.9.10、versionCode 118。

## 验收账号中断与收尾

首次页面门禁在最后的受限登录处返回 401：`smoke_limited`（ID 8）早在 9 月 7 日被软删除。前面的业务页面均通过，迁移已完整生效；部署保护因此停止后端写入，未回退不兼容旧后端。核实当前新镜像提交、记账契约与完整迁移后，恢复兼容的 v0.9.10 后端，公网 ready 恢复。

用户明确批准临时恢复此账号、验收后重新删除。仅清空该账号 deleted_at，保留原角色及 dashboard.view / inbound.order.view 两项权限，实际登录成功后重跑同一提交的网页/PDA 工作流。网页门禁成功后立即将 deleted_at 恢复为原值，递增 token_version 撤销访问令牌，并撤销该账号 16 条未撤销刷新会话；再次登录实测 401。未保留可用的临时测试账号，未改其他用户或账款。

**历史前置条件（已被 v0.9.11 新授权替代）**：当前页面脚本依赖已删除的固定受限账号，本次临时恢复不是永久启用授权。未经确认不得再次恢复；不能跳过权限门禁。长期应将受限验收账号改为安全配置及明确的临时生命周期，这是后续改进，未混入本次已签发 tag。

主开发目录已同步发布实现；发布工作树停在 `codex/release-v0.9.10`，不再占用 main。本次本地浏览器均已关闭，会话列表为空；生产验收容器已退出，仅正常前端、后端和 MySQL 容器运行。验收记录在本地文档提交保存，不为记录结果再触发一次生产部署。

本次证明安装包发布、摘要和包内版本正确，不等同于 Windows 实机安装、Android 真机升级、相机扫码或物理打印验收。

2026-09-09 用户在 v0.9.11 发布任务中明确授权恢复并长期保留受限验收账号。已轮换随机口令，发布门禁改为安全配置读取；后续不再执行本节旧的一次性删除流程，详见 `docs/release-v0.9.11-result.md`。
