# v0.9.16 发布记录

## 范围

用户于 2026-09-14 明确要求发布新版本。基线 v0.9.15 / 095c0be，发布业务 SHA **d94c7c9**，tag **v0.9.16**。

本版来自当天调查产生的三组改动（工作树 `codex/restore-trigger-20260914`，9 个提交）：

- **备份恢复**：迁移执行改为逐条执行（`sqlStatements.js`），新增迁移 241 重建存量触发器，
  修复 mysqldump 触发器函数体分号导致「备份可完整导入却报损坏」的误报；`restore-check.sh`
  导入前规范化并向钉钉透出真实报错。见 `docs/backup-restore-trigger-terminator-2026-09-14.md`。
- **PDA 收货**：修复 `receiveInboundApi` 缺 `X-Client: pda` 被 `pdaOnly` 拒成 403（2026-08-09
  起生产不可用）；去掉无意义的商品扫码框、点一次即提交、收完自动切下一个商品；新增静态契约回归。
  见 `docs/pda-receive-pda-only-2026-09-14.md`、`docs/pda-receive-remove-scan-2026-09-14.md`。
- **打印记录与补打**：记录页只记唯一码（空盒不进、拆分散货照记）；补打只保留打印记录页一个入口；
  销售订单不显示条码打印、收货订单只显示任务进度；无可用打印机时也留打印记录（迁移 242 允许
  `printer_id` 为空），塑料盒页新增「打印条码」。见 `docs/barcode-reprint-scope-2026-09-14.md`。

发布过程中 CI 暴露并已修复两处：workflow 步骤名含 `X-Client: pda`（冒号+空格）致 YAML 解析失败；
两处既有测试仍断言旧口径（无打印机不建任务、收货有打印标签）。

## 验证与发布状态

三端 package/lock 0.9.16；Android versionName 0.9.16、versionCode 124，与发布清单一致。

同 SHA（d94c7c9）工作流全部成功：Tests、Security Scan、Deploy Browser App、
Build Desktop Installer（push 验证构建与 tag 正式构建）、Build PDA APK。

- 桌面清单 `latest.json`：version 0.9.16，url `/versions/v0.9.16/FlowCube-Setup-0.9.16.exe`，
  sha256 `f6906ad6…4faff6`；**实际下载 107MB 并复核摘要一致**。
- `/api/app-update/latest`：0.9.16，notes 为本版 `docs/release-notes/0.9.16.md`。
- PDA 已发布清单：0.9.16 / versionCode 124，sha256 `b021dd54…597dd`，与服务器上 APK 文件摘要一致。
- 生产只读核验：站点 200、`/api/ready` ready；迁移 **241、242 已执行**；
  `print_jobs.printer_id` 已可空；四个触发器 `ACTION_STATEMENT` 末尾均不再带分号。

## 未验证

- 桌面端真机升级与本机打印、PDA 真机升级与相机扫码均未在本次执行（无对应设备）。
- 打印机物理出纸、物流面单实打仍未验收；本次只到「清单与产物摘要一致 + 线上服务就绪」。
- PDA 相关修复需现场把 PDA 更新到 124 后才会生效。
