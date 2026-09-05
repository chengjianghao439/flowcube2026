# v0.9.7 发布结果

三端正式发布完成。发布提交 `f755085908b9338e61ba48cf60c8f098c921abc9`，tag `v0.9.7`，PDA版本码115。浏览器于北京时间2026-09-05 23:46完成部署门禁，PDA于23:47发布；2026-09-06再次独立核对线上状态和APK下载摘要。

本次包括两轮审计修复及关联客户端修复，内容见[更新说明](release-notes/0.9.7.md)和[发布准备](release-v0.9.7-plan.md)。开发目录随后开始的业务中心改动不属于本版；发布记录在独立`codex/release-v0.9.7`工作树维护，未触碰该任务改动。

## 同一提交的工作流

| 工作流 | 结果 |
|---|---|
| Build Desktop Installer (v0.9.7) | [成功](https://github.com/chengjianghao439/flowcube2026/actions/runs/33975098901) |
| Security Scan (main) | [成功](https://github.com/chengjianghao439/flowcube2026/actions/runs/33975094667) |
| Tests (main) | [成功](https://github.com/chengjianghao439/flowcube2026/actions/runs/33975094623) |
| Build Desktop Installer (main) | [成功](https://github.com/chengjianghao439/flowcube2026/actions/runs/33975094686) |
| Build PDA APK (main) | [成功](https://github.com/chengjianghao439/flowcube2026/actions/runs/33975094597) |
| Deploy Browser App (main) | [成功](https://github.com/chengjianghao439/flowcube2026/actions/runs/33975094641) |

## 线上独立验证

- 服务器checkout、后端/前端镜像revision均为发布SHA，后端包版本0.9.7；两个应用容器running，MySQL健康。
- `/api/ready`返回HTTP200、ready。发布时真实报表、页面、对账回跳门禁全部通过，无回退结论。
- 桌面`/latest.json`与`/api/app-update/latest`一致，包含本版更新说明，正式URL为`/versions/v0.9.7/FlowCube-Setup-0.9.7.exe`。实际下载112,212,654字节，SHA256：`5b30159d3ac6618729445bf2aff18bd222d560eaa57e43dd574dfd49af4d1bab`，与清单和GitHub Release资产一致。
- `/api/pda/version`公布0.9.7、115、available=true；CI已核对APK内置versionName/versionCode。实际下载14,971,173字节，SHA256：`46988a08689d81b28aef60b1dad188344bfdffd25b412c36298fe88abef96425`，与清单一致。
- 本次生产门禁容器无残留。本地专用测试数据库已停止；本任务未额外创建浏览器会话，前轮会话已关闭。

机器记录见[JSON证据](release-v0.9.7-result.json)。下载校验为实际公网字节流哈希，不只读取清单字段。

## 尚未替代的验收

Windows安装与更新交互、物理打印，Android物理扫码与原生能力仍需实机验收。生产错误追踪接收端及自动异地备份目标仍待配置。历史异常单据不会因发布自动改写。上述限制不作为已完成项。
