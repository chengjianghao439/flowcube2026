# v0.11.0 发布结果

应用发布提交与标签均为 `b258dc5949e65098bd38e4061426cb09690e48cc` / `v0.11.0`。本版汇总主工作区与审计修复工作树的改动，具体内容见 [改动总览](release-v0.11.0-change-summary.md) 和 [用户版更新说明](release-notes/0.11.0.md)。浏览器、PDA 和桌面正式版本已发布；本结果记录属于事后文档，不进入上述应用产物。

## 同提交门禁与生产身份

| 必需工作流 | Run ID | 最终结果 |
| --- | --- | --- |
| Tests | [35865592796](https://github.com/chengjianghao439/flowcube2026/actions/runs/35865592796) | success |
| Security Scan | [35865592700](https://github.com/chengjianghao439/flowcube2026/actions/runs/35865592700) | success |
| Deploy Browser App | [35865592586](https://github.com/chengjianghao439/flowcube2026/actions/runs/35865592586) | 第 2 次运行 success |
| Build PDA APK | [35865747607](https://github.com/chengjianghao439/flowcube2026/actions/runs/35865747607) | 对发布 SHA 手动补触发，第 2 次运行 success |
| Desktop main 验证构建 | [35865592729](https://github.com/chengjianghao439/flowcube2026/actions/runs/35865592729) | success，仅验证 |
| Desktop tag 正式发布 | [35869364747](https://github.com/chengjianghao439/flowcube2026/actions/runs/35869364747) | 第 2 次运行 success |

生产仓库 HEAD、运行中的前端与后端镜像 OCI revision 均为上述 SHA。生产迁移记录包含一次 `257_seed_job_role_presets.sql`，库中有 7 个系统预置岗位；`/api/ready` 返回 `ready`。生产 CORS 预检实测允许 `https://jixuflow.com`、`https://localhost` 和 `null` 来源，未信任来源返回 404 且不反射来源。

## 安装包与线上验收

- [GitHub Release v0.11.0](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.11.0) 是公开正式版（Release ID `394752535`，`draft=false`），EXE 附件 ID `583951944` 为 `uploaded`。
- 桌面 `latest.json` 与 `/api/app-update/latest` 均为 `0.11.0`。官网 EXE 实际下载为 `112,379,657` 字节，SHA-256 `de3f8558961759e543005b0e38db68e6c5a97f012428e20cb2140d7f1c007c73`；GitHub Release 附件 API 的大小和 digest 一致。
- PDA `/api/pda/version` 为 `0.11.0` / `versionCode=144` / `available=true`。APK 实际下载为 `15,085,350` 字节，SHA-256 `62b6ac66d7f1426f87a4c4536647d95c9cc9bee4b06631f5fde9eb5a162ad1bc`。
- `npm run release:verify -- --origin https://jixuflow.com` 实际下载并流式校验 EXE 与 APK，**12/12** 项通过；健康与就绪接口正常。浏览器、PDA、桌面发布临时上传路径均已确认不存在。

## 失败与恢复记录

首个发布提交 `ebccff0534332365ac04a9fed7b7dc7fbf800aa1` 的 CI 在新增角色迁移处失败：MySQL 8 临时表沿用测试库默认 `utf8mb4_0900_ai_ci`，与 `sys_roles.code` 的 `utf8mb4_unicode_ci` 比较时报错。部署门禁因此没有执行服务器迁移。提交 `b258dc5` 给临时表显式指定相同排序规则，并增加回归断言；本地默认排序规则测试库完成全部迁移，正式提交的独立数据库任务和全套 CI 均通过。

首次浏览器部署与 PDA 发布在 SSH 主机键查找处失败：可信记录只含生产 IP，工作流用域名连接。核对域名解析和服务器 ED25519 指纹后，为同一公钥增加域名别名；浏览器与 PDA 均在同一发布 SHA 上补跑成功，没有跳过严格主机键校验。

桌面 tag 第 1 次运行的 GitHub 直连接收失败，本机中转三轮 2 MiB 分段下载均在尾部分段断流；SCP 回退按实测速率无法在 30 分钟预算内完成，因此主动取消该次运行。第 2 次运行重新构建并上传自己的原始 GitHub artifact（ID `10757111457`）；本机断点下载保留成功分段，对慢分段使用 256 KiB 子区间，先验证 artifact ZIP 的 GitHub SHA-256，再验证 EXE 摘要，交给服务器本次运行专用 `.relay` 路径。服务器接收器再次按 runner 预期字节数与 SHA-256 验收后发布，随后正式工作流和线上 12/12 核对通过。首次取消运行不记作成功。

Windows 实机安装、旧桌面客户端的自动更新弹窗，以及 PDA 真机的扫码、相机和作业流程仍需在设备上验收；自动构建与线上文件校验不代表这些设备行为已验证。
