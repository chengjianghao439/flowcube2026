# v0.10.8 PDA 作业体验发布结果

应用发布提交与 tag：`63047fc8f7dd403a61d0d2c73db3fe5227796912` / `v0.10.8`。浏览器、PDA 和桌面正式版本均已发布，线上 `release:verify` **12/12** 通过。以下发布工具修正和本记录是事后提交，不属于该应用安装包。

## 本版内容

- PDA 上架、拣货、分拣、拣货退回、改单确认、盘点和库存查询统一扫码条：默认直接接收设备扫码，点“手动输入”才弹键盘；移除库存查询扫码方式开关和输入区上方箭头提示卡片。
- 拣货列表补全商品规格、颜色、供应商型号、订单数与剩余数量，并允许同一商品多任务选择。
- PDA 作业结果统一一条悬浮提示；修正空页面轻微上下滚动；实体返回键返回上一页、工作台和登录页退到后台，屏幕由系统正常息屏。
- 约定连续开发期间集中在发版前跑完整验证，写入 `AGENTS.md` 和验证文档。

## 发布身份与线上证据

| 必需工作流 | Run ID | 结果 |
| --- | --- | --- |
| Tests | [35831132928](https://github.com/chengjianghao439/flowcube2026/actions/runs/35831132928) | success |
| Security Scan | [35831132933](https://github.com/chengjianghao439/flowcube2026/actions/runs/35831132933) | success |
| Deploy Browser App | [35831132916](https://github.com/chengjianghao439/flowcube2026/actions/runs/35831132916) | success |
| Build PDA APK | [35831132978](https://github.com/chengjianghao439/flowcube2026/actions/runs/35831132978) | success |
| Desktop main 验证构建 | [35831132918](https://github.com/chengjianghao439/flowcube2026/actions/runs/35831132918) | success，仅验证 |
| Desktop tag 正式发布 | [35834358800](https://github.com/chengjianghao439/flowcube2026/actions/runs/35834358800) | 第 1 次 attempt 交付失败；第 2 次 attempt 使用 relay 成功 |

生产前后端容器的 OCI revision 均为上述应用 SHA。GitHub [Release v0.10.8](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.10.8) 为公开正式版（Release ID `394456511`，`draft=false`），EXE 附件 ID `583354241` 为 `uploaded`，附件 API digest 与官网清单一致。

- 桌面：`latest.json`、`/api/app-update/latest` 均为 `0.10.8`；官网 EXE `112,374,397` 字节，SHA-256 `7755c3d1017d4dd3837ac7465cffcc99dacc5f374f5e3b108f026f2c36458088`。
- PDA：`/api/pda/version` 为 `0.10.8` / versionCode `143` / `available=true`；APK `15,080,054` 字节，SHA-256 `4c4029175740fb367d1d44d5a69961b243c2b3694dc73fcf396fa4073124ee8e`。
- `npm run release:verify -- --origin https://jixuflow.com` 实际下载 EXE 与 APK，12/12 项通过；健康接口正常。该结果证明产物可下载且摘要正确，不能代替 Windows 安装、桌面更新弹窗或 i6310pro 真机操作验收。

## 传输失败、恢复与原因边界

首次 tag 推送被 GitHub 以 `Internal Server Error` 拒绝。本地 tag 仍指向应用 SHA，确认远端不存在后重推同一 tag 成功，没有换版本或提交。

标准发布入口本次未开启本机中转。浏览器镜像服务器 HTTPS 接收在约 159 秒后失败，分片 SCP 直到 `07:44:39 UTC` 才完成；PDA HTTPS 接收同样在约 163 秒后失败，SCP 于 `07:55:54 UTC` 完成。桌面第 1 次 attempt 的服务器 HTTPS 接收在约 153 秒后失败（`08:02:26 UTC`），随后 SCP 到 `08:32:37 UTC` 满 1800 秒退出码 `124`。Windows 构建和同提交门禁均已成功，失败只发生在 EXE 交付，GitHub Release 上传因此跳过。

从同一 GitHub artifact 取 1 MiB 分片的只读探测：生产服务器直连返回 HTTP 206、`1,048,576` 字节、`19.49` 秒；本机现有代理返回 HTTP 206、同样字节数、`7.11` 秒。这一采样与三类大文件的直连失败/低吞吐相符，排除了“文件不存在或 GitHub 权限错误”作为本轮主要原因；**不能凭它断言某个具体跨境节点故障**。旧接收器隐藏 curl 退出码，无法把 HTTPS 失败进一步区分为超时、HTTP 错误或连接中断。

恢复时先预检本机 `flowcube-prod` SSH 与现有代理，然后对失败的桌面工作流执行第 2 次 attempt，并用 `local-release-relay.py` 锁定本次 SHA、tag、run attempt 和 artifact。GitHub 暂留第 1 次 attempt 的同名 artifact，旧监听器会因此提前耗尽重试；已修复为等待 `created_at >= run_started_at` 的新 artifact，并新增回归。第 2 次 attempt 的原始 ZIP artifact ID `10739239691`，中转下载及校验 `184.2` 秒、SSH 上传 `16.7` 秒，共 `200.8` 秒。服务器对 `112,374,397` 字节原包和 SHA-256 再次校验后发布，监听器等接收工作流成功才退出。最终工作流第 2 次 attempt 和线上 12/12 验收均成功；原失败 attempt 保留，不记作首次全绿。

以 main 运行创建 `2026-09-23 07:19:44 UTC` 到 tag 运行最终完成 `08:40:51 UTC` 计，完整发布历时约 **1 小时 21 分 07 秒**；第 2 次桌面 attempt 从 `08:34:15` 到 `08:40:51 UTC` 约 **6 分 36 秒**。这些时间包含原传输失败和恢复，不以重试起点掩盖总耗时。

## 发版后的固定流程

`release-flowcube` 技能与 `scripts/release-prod.sh` 改为单一正式路径：`npm run release:prod` 在 push 前强制预检本机代理与 SSH，自动启动本机中转；缺配置即停，不再让操作者在“直连 / 中转”之间选。CI 内的 HTTPS 与 SCP 只作为有界故障回退。接收器今后只打印安全的 curl 退出码和耗时，不输出短期签名 URL；本次隐藏的具体 curl 错误不倒推为已查明。新入口的脚本检查、相关发布工具回归和技能结构验证通过；它将在下一次正式发版中接受完整端到端验证。

Windows 安装、旧客户端更新弹窗与 i6310pro 上的本版扫码/键盘/返回键/息屏操作尚待真机确认。
