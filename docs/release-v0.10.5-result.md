# v0.10.5 发布结果

2026-09-22 三端发布完成，属于**失败后恢复完成**。全部本次业务改动和发布过程中补充的网络重试修复已提交并推送。

## 发布身份与范围

- 应用 SHA 与 tag `v0.10.5`：`889da386bdd4ab50f92f501623f6c08bf56fdd11`。
- backend / frontend / desktop：`0.10.5`；PDA：`0.10.5 / 140`。
- 生产前后端容器均 running，实际 OCI revision 均为上述完整 SHA；生产检出提交也一致。
- [GitHub Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.10.5)：ID `393570874`，`draft=false`，发布时间 `2026-09-22T08:43:12Z`。
- 覆盖全仓审计整改、ERP 长文本换行、PDA 单列/编码优先/详情全名、收货上架扫码反馈及发布状态查询的有界重试。业务范围见 `docs/audit-remediation-2026-09-22.md`、`docs/pda-code-first-2026-09-22.md` 和本版更新说明。
- 本结果文档后续提交只记录证据，不作为应用发布 SHA。

## 同一提交的工作流

| 工作流 | Run ID | 事件 / 分支 | 结果 |
| --- | --- | --- | --- |
| Tests | [35702797401](https://github.com/chengjianghao439/flowcube2026/actions/runs/35702797401) | push / main | success |
| Security Scan | [35702797392](https://github.com/chengjianghao439/flowcube2026/actions/runs/35702797392) | push / main | success |
| Deploy Browser App | [35702797427](https://github.com/chengjianghao439/flowcube2026/actions/runs/35702797427) | push / main | success |
| Build PDA APK | [35702980248](https://github.com/chengjianghao439/flowcube2026/actions/runs/35702980248) | workflow_dispatch / main | success |
| Build Desktop Installer | [35702797398](https://github.com/chengjianghao439/flowcube2026/actions/runs/35702797398) | push / main | success |
| Build Desktop Installer | [35705739726](https://github.com/chengjianghao439/flowcube2026/actions/runs/35705739726) | push / v0.10.5 | success |

PDA 最终运行通过 `workflow_dispatch` 指定 `checkout_ref=889da386bdd4ab50f92f501623f6c08bf56fdd11`：最后追加的发布脚本修复没有触发 PDA 的 push 路径过滤，因此补跑并明确绑定实际部署提交。浏览器和 PDA 均 success 后才推 tag；main 桌面验证构建与 tag 正式发布分别核实。

## 线上独立验证

- 自动完整验收 **12/12**：桌面清单、接口、说明、路径，PDA 版本、版本码、说明、可下载性，生产健康及 EXE/APK 实际下载摘要均通过。
- EXE：112374115 字节，SHA256 `0ed4588b5f819252a83740ef4cf0017353739866f26b03603e40da23b8bd1e4e`。GitHub 附件为 uploaded，其 digest 与官网实际下载一致。
- APK：15047445 字节，SHA256 `60d2304b522c07a5caf155030cd6067cded309ebbc38d771718705ab10f94fff`。
- 迁移 `256_acct_sale_source_period.sql` 已执行。另通过只读 information_schema 核对 `acct_vouchers.source_period` 为非空 `CHAR(6)`、默认空串；`uk_acct_vouchers_source_company` 为唯一键，列顺序严格为 `company_id,source_type,source_id,source_period`。只读取结构元数据，没有读取真实客户或账款明细。
- 线上 `index.html` 返回 200，含 nosniff、DENY 与 strict-origin-when-cross-origin 响应头。
- 本轮本地发布审计 85 项、发布工具 21 项、部署资源 25 项通过，官网文案/版本及文档引用守卫通过；网络重试新增用例先在旧实现出现 8 条失败，再验证全部通过。前序业务回归范围见整改文档，同 SHA Tests 最终 14 个 job 全部成功。

## 失败与恢复记录

1. 初始候选 `a90b07b059f43a128fafca3d6748092ec19c94a0` 的 Tests `35701666906` 因官网摘要出现内部术语“会话”失败；Browser `35701666855` 被门禁阻止，未切换生产。修正文案提交为 `553471ec5b2ab25a43e398d5b8da3c92075d3072`。
2. 本机等待程序两次遇到 GitHub `fetch failed`，一次直接连接、一次使用既有代理。追加 `wait-release-checks.js` 的有界重试：网络故障及 HTTP 429/502/503/504 最多 3 次、间隔 1/2 秒，仍受总等待预算限制；鉴权错误、损坏结果和 CI 失败不得放行。最终应用提交为 `889da38`。
3. 中间提交的 Browser `35702039239` 在等待 Tests/Security 时取消，PDA `35702039246` 同步取消，未进入生产切换。中间提交的业务 CI 成功，但不能替代最终提交的检查。
4. 最终浏览器传输走备用分片 SCP，约 205 MB。虽然本机中转另交付过相同摘要的镜像原包，仍按工作流实际记录认定为 SCP，不能仅凭 `relay: ready` 认定中转被采用。PDA 也走 SCP；桌面包使用本机中转，CI 明确记录接收端字节数与 SHA256 校验通过。
5. 三端发布和 12/12 验收成功后，本地 relay 仍因只识别 push、未识别 PDA 的 workflow_dispatch 而等待。已核对三端工作流全部结束后手动停止本任务监听器并清理。外层编排命令因此返回 1，含“中转未完整通过”的提示；这不是三端校验失败，本次也不能称为全程无人值守的一次成功发布。

## 时间与收尾

- 首次正式入口：`2026-09-22T07:50:44.848254+00:00`；线上完整验收：`2026-09-22T08:43:49.258986+00:00`。含修正、等待和恢复，总计 **53 分 04 秒**。
- 最终应用提交的正式入口：`2026-09-22T08:04:00.056662+00:00` 至上述验收，共 **39 分 49 秒**；编排器记录推送后的等待与验收 2385 秒。
- 本次复用已有本机代理和 SSH 中转，无新增云服务。浏览器、PDA 暂存路径和桌面本版中转目录已核验不存在；本任务 relay 进程和 SSH 控制连接已退出。没有启动用户电脑上的浏览器会话。
- Windows/PDA 真机安装和旧客户端更新弹窗未实测。现场“库存扫码完全无识别提示”的根因仍未确认，本版修复的是页面反馈缺失，不能声称已经解决所有硬件扫码问题。

完整运行日志、失败记录和脱敏结构验证保留在未提交的 `output/release-v0.10.5/`。
