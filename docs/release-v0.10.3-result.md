# v0.10.3 发布结果（2026-09-22）

已完成浏览器、PDA、桌面自动更新与 GitHub Release 发布。线上版本、健康和实际安装包下载摘要 **12/12 通过**。

- 应用发布提交：`846f146c89ebfe467138c5536d31636637567e63`，tag：`v0.10.3`。
- PDA：`0.10.3 / versionCode 138`。
- 后续 `2932dbb`、`ade3d7c` 仅修复发布工具、补发布工作流及说明，不改应用包；使用 `[skip ci]` 避免重建已发布版本。
- 本机工作区与生产前后端镜像 revision 均已核对；生产镜像对应上述应用发布提交，后端报告 `0.10.3`。

## 验证证据

| 项目 | 结果 / 运行 |
| --- | --- |
| Tests | [success，35677471245](https://github.com/chengjianghao439/flowcube2026/actions/runs/35677471245) |
| Security Scan | [success，35677471331](https://github.com/chengjianghao439/flowcube2026/actions/runs/35677471331) |
| 浏览器部署、页面与权限验收 | [success，35677471377](https://github.com/chengjianghao439/flowcube2026/actions/runs/35677471377) |
| PDA 构建及发布 | [success，35677471284](https://github.com/chengjianghao439/flowcube2026/actions/runs/35677471284) |
| main 桌面验证构建 | [success，35677471335](https://github.com/chengjianghao439/flowcube2026/actions/runs/35677471335) |
| tag 桌面构建 | [35678212932](https://github.com/chengjianghao439/flowcube2026/actions/runs/35678212932)：构建、官网发布和 GitHub 附件上传成功；草稿按 tag 查询返回 404，收尾校验失败。保留原失败记录。 |
| 原包补发布及线上完整性验收 | [success，35679260060](https://github.com/chengjianghao439/flowcube2026/actions/runs/35679260060)：验证原 tag/SHA、同提交门禁和三方摘要后仅转正现有草稿，未重建、重传或更换 EXE。 |
| GitHub Release | [v0.10.3](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.10.3)，已公开，附件 uploaded |

EXE：112,367,875 字节，SHA256 `8ffe248f13df1c064b9745bd31645228f079f29e26628365a15fdabd4764937f`。

APK：15,044,354 字节，SHA256 `93ec93f267c22e4ef5d30c1e090b3d2de8c9fe76afad817af457dac97cdbf12e`。

## 耗时与限制

时间均为北京时间。最终应用提交于 09:54:02 触发发布，浏览器 10:03:47 完成、PDA 10:05:35 完成、桌面官网清单 10:10:25 生效。GitHub 原包补发布 10:23:26 转正、10:23:46 工作流成功。

- 最终应用提交到完整收尾：**29 分 44 秒**，包括草稿问题的排查与补发布；不是全程一次全绿。
- 首轮 08:48:58 到最终收尾：**1 小时 34 分 48 秒**，包含兼容性、网络、验收地址和附件收尾问题的修复重试。
- 本轮镜像/PDA/EXE 受信中转分别为 **129 / 37 / 86 秒**；中转下载验证 GitHub artifact ZIP 摘要，服务器再次验证 runner 原包大小及 SHA256。
- **15 分钟目标未达成**。直连跨境链路仍慢，本次依赖操作端通过现有系统代理分段下载及 SSH 中转，不能声称无人值守直连已稳定达到 15 分钟。
- Windows/PDA 真机安装与更新弹窗体验未在本次执行，不能从 CI 或下载验证推断。

取消上传残留的本任务 2.5 MB 临时 APK 已在确认服务器 IO 空闲后删除；未清理无关文件。审查范围与数量修复详见 `docs/harness-changes-audit-2026-09-22.md`，排障过程详见 `docs/release-flow-speed-2026-09-22.md`。
