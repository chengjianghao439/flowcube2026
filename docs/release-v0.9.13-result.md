# v0.9.13 全分支整合与发布记录

## 发布范围

- 主目录原 59 个改动文件已提交，包含条码打印、真实模板预览、更多标签字段、操作列拖动、大列表性能与德邦接入说明。
- 标签工作树已提交并合入；依赖符号链接已移除，实际依赖目录保留。
- `codex/party-ledger` 的未合入功能按审核后的源码路径整合：登录页、履约面板、快递账号联动、顺丰常用服务与两家配置传递；原始分支提交和 output 历史安装包/临时运维脚本保留在本机备份，未作为发布源码重放。重叠的 HTTP 校验保留当前实现，账号页保留无删除入口。
- `codex/release-v0.9.7` 和 `codex/party-ledger` 中的 v0.9.10 历史验收文档已合入。其余发布分支均已包含于 main；旧 `fix/integration-test-green` 4 个补丁经 git cherry 确认为主线已有，不重复恢复其旧版实现。
- 本机源码备份位于受限 `~/.config/flowcube/release-backups/20260909-all-branches`。本机 output 校验截图、安装包、运行脚本、依赖及凭据不属于发布源码。

## 发布前验证

- 合并后前端 53 文件 / 277 项通过；两端 lint 无错误（前端 5 项既有 fast-refresh 警告），app TypeScript、ERP 与 PDA Web 构建通过。
- 快递规则 50 项、履约规则 5 项通过；新增受限凭据与部署工具相关 57 项通过，SSH 前校验四项门禁凭据。
- 回环一次性独立库：打印字段/预览 27 项、队列 8 项、清理 4 项、主链路及快递入队/并发回归通过；测试库已删除。未在生产运行这些数据库测试。
- 合入后本地已登录页面：快递账号定位、无删除入口、销售单及发货安排可访问；未保存业务资料。合入前打印字段本地页面验收已通过；源码规格和代码质量复核通过，分支登录/履约/快递源码审查通过。
- 三端完整 npm audit 均为 0 漏洞。新增提交内容 Gitleaks 检查通过；原始未推送分支扫描无检出，但其历史 output 仍仅保留于本机。

## 版本与发布门禁

已发布三端 0.9.13，PDA versionCode 121。未新增数据库迁移。更新内容见 `docs/release-notes/0.9.13.md`，官网摘要同步。

正式发布须核对该 tag SHA 的 Tests、Security Scan、Deploy Browser App、Build Desktop Installer（tag）、Build PDA APK，及线上健康/更新清单/安装包摘要。Windows/Android 实机升级、打印走纸及快递真实订单不在本机软件验收范围内。

v0.9.11 的共享测试库空数据断言导致 CI 失败并阻止部署，保留其标签。修复仅调整测试隔离：未登录 401 独立验证，十类空数据回退由专属仓库与商品夹具验证；按退款测试 → 打印预览测试顺序在一次性测试库复现失败后验证通过。v0.9.12 提交 `6d54168eaa8b8b84b4e3e262fbdf9e78b62b3379` 的 CI 在全局 printer_bindings.print_type 唯一键夹具插入处失败，部署被阻止。按并发护栏 → 打印预览顺序已本地复现；补齐原绑定保存/恢复后改发 v0.9.13，不复用标签。

## 权限验收账号

用户于本次发布明确批准恢复并长期保留受限验收账号，发布后不删除，替代上版的一次性恢复约定。已核实并恢复 ID 8，角色仅含 dashboard.view 和 inbound.order.view；口令轮换为随机值，旧访问令牌和刷新会话撤销。GitHub Secrets 已配置 `SMOKE_LIMITED_USERNAME` / `SMOKE_LIMITED_PASSWORD`，发布页面门禁要求显式注入，保留原有 403 与有权页面的对照验证。

生产备份：服务器 `backups/release-v0.9.11/flowcube_20260909_021805.sql.gz` 完整性校验通过，SHA-256 `0ecbdd0263b147293bc6b3bb56132f7a8b78b870963347b25a813a9e8829aa73`。备份保存在服务器受限目录，不冒充异地灾备验证。

## 正式发布验收

发布提交 `f423ec1015111d8e51eb632365ee72cada1fcb82`，tag `v0.9.13`。2026-09-09 全部同 SHA 工作流成功：

| 检查 | 结果 |
|---|---|
| [Build Desktop Installer（v0.9.13）](https://github.com/chengjianghao439/flowcube2026/actions/runs/34264118491) | success |
| [Security Scan（main）](https://github.com/chengjianghao439/flowcube2026/actions/runs/34264111014) | success |
| [Tests（main）](https://github.com/chengjianghao439/flowcube2026/actions/runs/34264110947) | success |
| [Build Desktop Installer（main）](https://github.com/chengjianghao439/flowcube2026/actions/runs/34264111005) | success |
| [Deploy Browser App（main）](https://github.com/chengjianghao439/flowcube2026/actions/runs/34264110953) | success |
| [Build PDA APK（main）](https://github.com/chengjianghao439/flowcube2026/actions/runs/34264111068) | success |

- 服务器 Git HEAD、前后端镜像 OCI revision 均与发布提交一致；MySQL healthy，前后端 running，公网 `/api/ready` 与 `/api/health` 正常。
- 生产页面、PDA 页面、条码查询、受限账号 403/授权访问对照及财务对账回跳门禁全部通过；本次验收容器已退出，服务器未残留 gate 容器。
- `/latest.json` 与 `/api/app-update/latest` 为 0.9.13，包含本版更新内容和 `/versions/v0.9.13/` 下载地址。Windows 安装包实际下载 112,343,448 字节，SHA-256 `cc5d7e5119548eb246bda5c863c68639612ff887f363cc0f6d8afa7854cdc692`，与清单及 GitHub Release digest 一致。
- `/api/pda/version` 为 0.9.13 / 121、available=true。实际 APK 下载 15,013,522 字节，SHA-256 `11270cc013801f01478dcc30821c0e993ac1bc7f44951866ae038de48a502ec2` 与清单一致；aapt 实测包名 com.flowcube.pda、versionName 0.9.13、versionCode 121。
- 发布后只读核验 ID 8 仍启用且未删除，权限仍只有 dashboard.view / inbound.order.view；按用户要求长期保留，没有执行删除或停用。
- 按 CI 顺序完成 29 个本地测试文件，全部退出 0，一次性测试库已清理。最终新增提交范围 Gitleaks 无检出。

发布元数据见 `docs/release-v0.9.13-result.json`；原始日志、下载包与本地测试日志保留在主目录 `output/release-v0.9.13/`，不纳入源码。原始私有分支与输出备份保留，不删除其他任务资源。

## 收尾与限制

验收记录单独提交于 codex/release-v0.9.13，发布 main/tag 保持上述已验证 SHA。所有开发/历史发布工作树已核验；本次浏览器会话已关闭，本机 agent-browser 会话列表为空。发布工作树停留在专用分支，不占用 main。AGENTS.md 与相关说明已同步。

当前电脑没有打印机，未做物理走纸验收；Windows/Android 实机安装升级和真实快递下单仍需对应设备及正式业务验收。软件与发布验证不替代这些结果。
