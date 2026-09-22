# 免费优先的发布中转实测

目标：不新增云资源费用，使用现有 Mac 网络将 v0.10.4 三端原始 CI 产物自动交付生产，完成全流程验收。用户已授权发版与跟踪优化；OSS 开通请求已由免费优先指示替代，未执行。

- [x] 归档未提交的 OSS 试验到本机任务临时目录，移除正式路径中的未使用 SDK 与安全扫描配置。
- [x] 先写来源绑定、分片重试、ZIP/摘要测试，确认缺实现时失败；实现本地 watcher，保留接收器独立校验。
- [x] 正式入口支持显式启用、推前预检、Mac 防睡眠与退出清理；ready 后等待接收完成。
- [x] 完成本地发布工具、部署资源、技能/文档守卫与反向测试；核对实际 SSH/API 前置条件。
- [x] 更新 v0.10.4 说明、三端/PDA 版本和官网摘要，逐路径提交。
- [x] 正式入口发版，跟踪同 SHA CI、三类中转、tag、GitHub Release 和线上下载摘要。
- [x] 记录首次启动至完成耗时、各阶段耗时、失败/回退、资源收尾与未覆盖真机验收。

测试：`npm run test:release-tooling`、`npm run test:audit-tooling`、`node --test tests/deployment-resources.test.js`、`npm run test:agents-md-guard`、`npm run test:landing-updates`、`bash -n scripts/release-prod.sh`、`git diff --check`。

免费边界：无新增存储、云加速、中转服务器或代理采购。现有服务器/网络费用仍存在。不得把本地自动中转描述为无需 Mac 的托管发布。

本地证据：release-tooling 21 项、audit-tooling 与 deployment-resources（25 项）全部通过；新增 Python 中转行为覆盖 15 项。反向破坏分支绑定、ZIP 摘要或接收完成等待均被测试拒绝。真实 SSH 预检通过；初次预检暴露 macOS socket 路径过长，已改为受控短临时路径并复测通过。

## 首轮实测修正

应用提交 `48ee3d406300a3f78bf4abbab773ec9e8cabb965` 于 03:28:54 UTC 开始。Tests、Security、桌面 main 验证通过，APK 已构建。镜像下载使用分批屏障，少数慢分片阻塞下一批；205 MB 原始 ZIP 未能在旧接收窗口内就绪。主动取消浏览器运行 `35683308441` 和等待中的 PDA `35683308399`，未推 tag；首轮不能记为全绿。

新增慢分片不阻塞后续工作的行为回归，已证实旧实现失败。改为固定 worker 持续补位，URL 缓存最多 30 秒及失败刷新，接收窗口 900 秒、远程接收 1100 秒，部署步骤/job 和 PDA 等待预算联动调整并由守卫从源码计算。首轮耗时和取消记录必须计入最终总时长。

最终第二轮全绿，线上 12/12 核验，详情见 [发布实测结果](../../release-v0.10.4-result.md)。包含修复的首次入口至完成 31 分 08 秒，第二轮入口 17 分 42 秒。
