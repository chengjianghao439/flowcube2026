# v0.11.5 发布结果（2026-09-30）

> **结论：v0.11.5 已发布。** 官方入口 `npm run release:prod` 自然退出 0，用时 **877 秒**（含门禁、部署、制品交付和线上下载验收）；随后独立执行 `npm run release:verify -- --origin https://jixuflow.com`，**12/12 通过**。设备安装、实际扫码与物理出纸仍未验。

## 发布身份与范围

- **应用 SHA / tag `v0.11.5`：**`6206dbff0f3ebd01c2377d1b140b69ef23e2ea08`。tag、发布时 `main` 与 `origin/main` 均指向此 SHA。
- 桌面、前端、后端版本 `0.11.5`；PDA `versionName 0.11.5` / `versionCode 149`。
- 本版包含测试修复专项的一次性实例归属门、C4/资金补验与现场清单的后续记录，以及慢查询监控由历史累计改为最近 24 小时统计。**无新数据库迁移文件或业务状态机改动**（对 `v0.11.4..6206dbf` 的迁移目录差异为空）。旧 repair 库事故未由此恢复，见 `docs/incident-repair-db-2026-09-29.md`。
- 发布内容：`docs/release-notes/0.11.5.md`；官网摘要：`frontend/src/pages/landing/updates.ts`。

## 同一 SHA 工作流

| 工作流 | Run ID | 结果 |
|---|---:|---|
| Tests | `36613236471` | success |
| Security Scan | `36613236999` | success |
| Deploy Browser App | `36613236822` | success |
| Build PDA APK | `36613236904` | success |
| Build Desktop Installer（`main` 验证） | `36613236735` | success |
| Build Desktop Installer（**`v0.11.5` tag 正式发布**） | `36614497897` | success |

前述六条工作流的 `headSha` 均为完整应用 SHA。`main` 上的桌面验证构建与 tag 正式发布分开核对。

## 制品、线上与生产核对

| 制品 | 来源 run / artifact | 原 artifact ZIP | 解包后制品与 SHA-256 |
|---|---|---:|---|
| 浏览器镜像归档 | `36613236822` / `11054950786` | 205,143,890 B | 205,143,732 B；`2fd4b87b95a3d438ac352020565874d0e8fd39694a34dfe42e282886714add20` |
| PDA APK | `36613236904` / `11054142778` | 10,202,878 B | 15,108,351 B；`8edab2f9661637ef8ae9f7727933c535aa3aa96b98e406232934547407841580` |
| Windows EXE | `36614497897` / `11054363857` | 112,413,166 B | 112,413,000 B；`bef54d9f8e54384a94bd4b58333bcca5d6fc43d34f04ddef080478edb976e386` |

ZIP 与解包后制品是不同文件，字节数不混称。镜像摘要由 runner 构建记录及本机中转交付记录核对；EXE/APK 摘要又经线上实际下载核对。本次发布依赖本机在线的自动中转，不能视为完全托管的传输链路。

- [GitHub Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.11.5)：`isDraft=false`，`publishedAt=2026-09-29T18:50:30Z`；附件 `Jixu-Flow-Setup-0.11.5.exe` 为 `uploaded`、112,413,000 B，GitHub digest 与上表 EXE 相同。
- `https://jixuflow.com` 的 `latest.json` 与 `/api/app-update/latest` 均为 `0.11.5`，安装包路径为 `/versions/v0.11.5/FlowCube-Setup-0.11.5.exe`；`/api/pda/version` 为 `0.11.5/149`、可下载；`/api/health=ok`。独立验证命令 **12/12**，EXE 112,413,000 B 与 APK 15,108,351 B 实际下载 SHA-256 均匹配。
- 生产主机只读核对：检出 HEAD、backend 和 frontend 容器的 OCI `org.opencontainers.image.revision` **三者均为应用 SHA**。

## 钉钉慢查询告警：已验与边界

- 发布前只读核对：慢日志共有 **253** 条历史 `# Time:` 记录，最后记录停在 **2026-09-19**；按候选的 24 小时统计为 **0**。旧脚本仍按全文件累计数，在 9 月 25–29 日每天重报“慢查询日志累积 253 条”。
- 发布后生产监控脚本 SHA-256 与仓库 `scripts/monitor.sh` 相同（`8d85ca13187c110ab77975d365c3474de5f52d5ad00fad7e94b29d9332d05468`）；`backups/.monitor.state` 为 `ok 0`，监控日志于 **2026-09-30 02:45:04 +08:00** 记下“✅ FlowCube 服务已恢复正常”。该轮日志未见发送错误。**这证明服务器监控状态恢复；钉钉客户端群消息是否实际可见未在本机直接观察。**
- 历史慢日志保留；本次未清日志、未手改监控状态文件，也未更改告警阈值 50。

## 本地验证与剩余边界

- 发版前本地：版本/官网摘要守卫、AGENTS 守卫、监控及部署 43 项、测试实例归属 14 项、发布编排 25 项、发布工具 21 项均通过；前端 lint（0 error、33 条既有 Fast Refresh warning）与 `tsc -p frontend/tsconfig.app.json --noEmit`、后端 lint、桌面 renderer 与 PDA renderer 构建均 exit 0。完整 CI Tests 则以上表同 SHA `success` 为准。
- 测试防误清理保护在本批新建一次性 MySQL 实例上的正路径已有两轮实跑、自然退出和资源收尾证据；**真实实例拒绝反路径未验**，不把 14 项离线守卫等同于它。旧 repair 库原始数据量不明、未恢复。
- C4 发布后真实 GUI 已有“后台 200 后丢响应→刷新/重绑→原请求身份保留”和“切到另一任务确认原回执不误完成当前任务”的有限夹具证据；这不等于真 PDA 设备或真实打印。
- **待现场：**Windows 旧版到 0.11.5 的实际更新提示/安装/登录；Android 0.11.5/149 原地安装、硬件扫码、断网/重启恢复；取货标签与箱贴实际出纸、贴货、实扫下游作业。资金 A/B 时序的真实 GUI 与测试归属门的真实拒绝反路径亦未验。本版没有为这些未验项声称通过。
