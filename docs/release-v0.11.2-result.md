# v0.11.2 一致性审计修复发布结果

应用发布提交与标签：`d65550bf28f77ab828c4d4af6584599094882155` / `v0.11.2`。浏览器、PDA 与桌面正式版均已发布；本文件是事后记录，不属于安装包。

## 发布身份与线上证据

| 工作流 | Run ID | 结果 |
| --- | --- | --- |
| Tests | [36257614561](https://github.com/chengjianghao439/flowcube2026/actions/runs/36257614561) | success，所有 job 成功 |
| Security Scan | [36257614559](https://github.com/chengjianghao439/flowcube2026/actions/runs/36257614559) | success |
| Deploy Browser App | [36257614563](https://github.com/chengjianghao439/flowcube2026/actions/runs/36257614563) | success |
| Build PDA APK | [36257614576](https://github.com/chengjianghao439/flowcube2026/actions/runs/36257614576) | success |
| Desktop main 验证构建 | [36257614562](https://github.com/chengjianghao439/flowcube2026/actions/runs/36257614562) | success，仅验证 |
| Desktop tag 正式发布 | [36258826563](https://github.com/chengjianghao439/flowcube2026/actions/runs/36258826563) | success |

生产部署日志显示后端、前端加载的镜像标签均为 `d65550bf28f77ab828c4d4af6584599094882155`；发布后只读 `docker inspect` 复核了两只运行中容器的 `org.opencontainers.image.revision`，也均为该完整 SHA。迁移 `258`–`262` 执行完成，健康和页面门禁通过。GitHub [Release v0.11.2](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.11.2) 为公开正式版（Release ID `397330308`，`draft=false`），EXE 附件 ID `591106014` 为 `uploaded`，附件 digest 与线上清单一致。

- 桌面：`latest.json`、`/api/app-update/latest` 均为 `0.11.2`；EXE `112397802` 字节，SHA-256 `461b5a1e94b9d0f5a6ab28dfc1fc2ac26275f35b7c02541f29106aba5b53720b`。
- PDA：`/api/pda/version` 为 `0.11.2` / versionCode `146` / `available=true`；APK `15088643` 字节，SHA-256 `e959168086a56ea6e584243505a47673100627b69eb14f34a34d57e348a2e401`。
- `npm run release:verify -- --origin https://jixuflow.com` 在发布入口结束后独立复验，实际下载 EXE 与 APK、核对摘要及健康接口，12/12 项通过。

## 本版内容与验证

本版包含 2026-09-26 一致性审计修复：退货入库后取消改为独立返货出库，已结账期间的跨期补录经审批后记当期调整凭证，运费应付及逐笔选择借方科目的手工应付进入总账，并修复采购应付撤回、仓库权限与幂等边界。Claude 的 `release-flowcube` skill 已与仓库正式流程同步；通过与 Claude 的只读对话核对，它会使用 `npm run release:prod`、同 SHA 门禁与版本标签，而不是直接暂存全仓后推送。

发布前独立 MySQL 8 测试库完整执行至迁移编号 `262`，并复跑幂等、结构对账；专项 `smoke:audit-20260926` 在独占库的 8 个测试文件全部通过（应付入账 32/0，其余专项 289/0）。财务、会计、期间、主链、并发、退款、权限、打印等受影响回归，前后端 lint、类型检查、ERP/PDA 构建、前端单测及发布守卫通过。最终提交的 Tests CI 全部 job 为 success。

## 失败与恢复、耗时

发布前共有三次保留的失败运行，均在创建版本标签之前停止：

1. `f571e78` 的 [Tests 36256481350](https://github.com/chengjianghao439/flowcube2026/actions/runs/36256481350)：用户文案守卫和 UTC 环境下的日期断言暴露问题。
2. `4306ad5` 的 [Tests 36256886268](https://github.com/chengjianghao439/flowcube2026/actions/runs/36256886268)：进一步确认手工月结到期日依赖数据库会话时区；静态审计测试缺少新期间闸门的隔离夹具。
3. `6b56053` 的 [Tests 36257253178](https://github.com/chengjianghao439/flowcube2026/actions/runs/36257253178)：前端交互测试仍断言修改前的技术文案。

修正后 `d65550b` 的全部必要工作流成功。首次 GitHub Tests 创建于 `2026-09-26 16:43:34 UTC`，最终桌面工作流完成于 `17:28:16 UTC`，跨失败与恢复的可核对耗时至少 **44 分 42 秒**。最后一轮从 `17:02:44 UTC` 到 `17:28:16 UTC` 为 **25 分 32 秒**；发布入口报告约 1539 秒，包含本地预检、等待和下载验收。

本次发布仍依赖本机在线中转；PDA 和桌面产物通过本机 relay 完成交付。浏览器镜像虽已由 relay 准备并校验，CI 的 HTTPS 快路径未取用，实际回退为分片 SCP 上传，额外耗时约 7 分钟；不能据此认定发布链路已脱离个人电脑或实现全程快路径。

## 验收边界

线上清单、接口、下载摘要和部署页面门禁已验证。**Windows 实机安装及旧客户端更新弹窗、PDA 真机扫码和外设操作仍未验收**；CI 与下载完整性不能替代设备验收。
