# 2026-10-06 打印安全扫描修复

工作树：`codex/security-scan-remediation`，基线 `14e97aa`。本文记录本地实现与验证，未提交、未部署，未操作物理打印机。原始证据为 `output/security-scan-2026-10-06/findings.json`（编号按 1-based）。

## 修复范围

| Finding | 实现 | 验证边界 |
| --- | --- | --- |
| #6 工作站身份冒用 | 随机可撤销凭据；心跳、领取、成功/失败及本机完成绑定工作站和本次领取；公开 clientId / printer code 不能鉴权 | 真实隔离 HTTP/DB 已测；桌面安装与物理出纸未测 |
| #14 打印机/客户端/统计/健康跨仓 | 打印机读写与客户端管理严格校验原仓/目标仓；全局或未知仓资源对限仓用户关闭；用途绑定在事务内锁打印机仓；统计与健康 SQL 带范围 | 隔离 HTTP/DB 与真实函数边界回归 |
| #15 ZPL 与份数展开 | 后端、渲染进程及 Electron main 同时限单份 UTF-8 1 MiB、整批 8 MiB；1–100 整数；IPC 只传单份，main 顺序提交，失败即停止 | 有 100 份、中文 UTF-8、部分失败等虚拟 RAW 测试；没有实物打印 |
| #18 Unix 临时文件攻击 | 每次 RAW 创建私有临时目录，目录 0700、文件 0600、exclusive `wx`，`finally` 清理 | Linux 路径注入与受控 lp 失败的真实文件测试；没有操作系统打印设备 |
| #24 单据模板资源预算 | 写入和存量读取均校验有界 schema；前端渲染先校验元素、表列、行/单元格，超限返回清晰错误 | 真实服务函数、React SSR 的边界/最大合法节点预算 |
| #16 打印分页（追加） | page/pageSize 先验有限 safe 正整数；再 normalize cap 500；offset 须 safe；三种条码查询同口径；队列列表仅 metadata | 先红后绿真实 query 测试，无正文列表消费者 |

## 凭据契约与部署顺序

迁移 `277_print_client_credentials.sql` 幂等新增工作站 `credential_hash` / `revoked_at` / `warehouse_id` 和任务 `claimed_client_id` / `claimed_credential_hash`；检查已存在列的类型与 nullable，形状不符即失败。历史客户端没有凭据，不回填、不给公开 ID 附加权限。

管理员需要 `print.printer.manage`。`GET /printers/registration-warehouses` 只列其有权管理的活跃仓库；`POST /printers/clients/register` 只能创建新工作站，重复 clientId 返回 409，消费权限不能注册。工作站所属仓固定；打印机关联必须同仓。限仓管理者不能注册全局工作站、把其他仓打印机关联到自己，或通过撤销/别名改写管理外仓客户端。撤销保留历史，不重新发放旧 ID 的凭据。

注册仅一次返回 `credential`（32 字节随机值的 64 位 hex）。服务端只保存 SHA-256。消费请求同时携带登录授权、`X-Client-Id` 和 `X-Print-Client-Credential`；body 中的 clientId 不参与身份判定，printer code 仅作路由元数据。claim 保存凭据代次及随机 ackToken；完成/失败必须命中 PRINTING、本次 token、工作站及凭据代次，且凭据仍未撤销。`complete-local` 同样要先 claim，不再允许直接核销 PENDING。撤销之后已经领取的任务也不能用旧凭据核销。

Electron 主进程生成随机 `desktop:<UUID>`；非敏感 ID 单独保存。凭据按服务器 origin 分隔并用 Electron safeStorage 加密，权限 0600；安全存储不可用或 Linux `basic_text` 时仅驻留内存，重启需重新注册，无明文回退。preload 提供 get/set/reset IPC，均经过既有 renderer guard。前端不把凭据写入 localStorage / 登录存储；消费请求固定该服务器并关闭 API 候选地址回退。共享日志需脱敏 `credential` 和 `X-Print-Client-Credential`，由主代理统一负责。

正式上线应先迁移，再部署兼容后端/桌面/前端。旧客户端立即 fail-closed。新版显示“升级桌面端，由管理员打开设置 → 打印机管理注册本机”指引。管理员选择本机仓库，重新注册，再逐台关联已安装打印机。重新注册撤销旧凭据并换随机 ID；已领取任务需人工核对原打印结果，不自动重打。安全存储不可用时界面提示重启后重新注册。

本轮没有改变商品主数据标签的业务仓归属：现有 `enqueueProductLabelJob` 仍生成 `warehouse_id=NULL` 的任务，限仓消费仍不能领取这种全局任务。若需要限仓商品标签消费，应另明确按目标打印机归属落仓并透传调用者 scope；不能以放开全局任务 scope 代替。

## 内容与渲染预算

ZPL 在入队前计 UTF-8 字节，单份 ≤1 MiB，`bytes × copies` ≤8 MiB，份数为 1–100 整数。旧存量大正文领取前按 `OCTET_LENGTH` 拒绝，记 FAILED，不把大正文发送给桌面端。任务分页上限 500 时只选 metadata 字段，详情一次取一份，claim 最多 10 项。客户端复核同一预算；含 `^PQ` 的模板不允许再叠加任务份数。main 每次只向 OS 提交同一单份，部分失败给出已提交份数与人工核对说明，停止后续份数。

物流条码列表也只选 metadata；入/出库列表及计数的最近任务派生表均不再 `SELECT j.*`，避免分页间接装载标签正文。原始 ZPL `applyZplTemplate` 先验未 trim 的 body，再扫描占位符，逐段累计原文和替换值的 UTF-8 输出大小。相同变量仅读取/sanitize 一次并缓存；累计超限在最终 `replace` 分配展开结果前抛 `PRINT_CONTENT_BUDGET_EXCEEDED`，明确拒绝，不截断。旧数据库 raw 模板使用路径也在 trim 前检查 body，超大空白不能绕过预算。

标签预算检查位于原 `buildLabelBody` 渲染降级边界。收货/装箱事务中的超限仍通过同一事务连接记录 `status=3`、空正文、`label render failed: PRINT_CONTENT_BUDGET_EXCEEDED`，不回滚业务事实。RAW 已提交后核销网络失败仍只重试回执；不再出纸，不改报物理失败。

单据模板 type 1–4：layout ≤64 KiB，最多 128 元素、一个 table、10 列；字符串、坐标、字号、枚举与可选字段有界，拒未知结构、重复元素 ID。前端包括存量模板，渲染前限制 2000 行、20000 单元格（序号列也计入）。超过预算呈现明确的“精简模板或分拆单据”错误，本次不生成明细，绝不截断已有单据。合法最大结构 SSR 节点计数受测（2002 个 tr / 10002 个 td），时间预算 <3 秒，实测约 90 毫秒。

## 红绿证据及复跑

- 第一轮原漏洞六条真实函数/文件回归：修复前 0/6、自然 exit 1；修复后通过。第一次因环境未配置而无法加载模块的试跑属于设置失败，不计漏洞红证据。
- 独立复审新增列表正文与非法分页两条：11 pass / 2 fail、自然 exit 1（`/tmp/flowcube-security-print-pagination-red.log`）；修复后 13/13、自然 exit 0（`/tmp/flowcube-security-print-pagination-green.log`）。
- 最终离线 suite 包含事务内预算降级、存量读取、旧站停用和绑定锁等，14/14、自然 exit 0（`/tmp/flowcube-security-print-final-offline.log`）。
- 第二次独立复审新增三条（物流/入出库 metadata、raw 替换前预算、旧 raw 原文预算）：14 pass / 3 fail、自然 exit 1（`/tmp/flowcube-security-print-second-review-red.log`）；修复后最终 17/17、自然 exit 0（`/tmp/flowcube-security-print-second-review-green.log`）。metadata 测试的阈值读取替身已设置，红证据是正文投影及缺少预算拒绝，不是初始化失败。
- 独立代理只读复核两项，17/17、4 个后端文件 ESLint、diff check 均自然 exit 0；另核原 320 KiB → 2 MiB 反例、UTF-8 精确 1 MiB / +1 byte、单次嵌套替换，报告剩余 must-fix=0。SQL 投影的最后数据库兼容性仍由主代理串行验证。
- 隔离数据库新版身份/仓范围/claim/ack smoke 11 个场景、自然 exit 0（`/tmp/flowcube-security-print-db-retry.log`）。首次运行前 9 场景通过，随后自有 health fixture 重复主键，已改为只对本轮 printer upsert；该次不能计全套成功。
- `smoke:print-queue` 14/14、自然 exit 0（`/tmp/flowcube-security-print-queue.log`）。最后绑定事务/模板读取/metadata 调整后的 DB 复跑由主代理串行统一执行，结果并入总报告。
- 前端 `tsc --noEmit -p tsconfig.app.json`、定向 ESLint 自然 exit 0；Bridge / TemplateRenderer 两文件共 21 Vitest tests、自然 exit 0。`test:print` 35 项和 `test:print-entry` 自然 exit 0。
- 追加 raw 修改后 `test:label` 自然 exit 0（`/tmp/flowcube-security-print-label-final.log`）；`print-barcode-void-guard` 8/8、自然 exit 0，状态与作废边界保持。
- `test:print-purge` 无环境试跑被 NODE_ENV 隔离门挡下，自然 exit 1，未连接数据库；其数据库验证由主代理执行。没有把组合 shell 最后一个 exit 0 当作整批通过。

在本工作树及 Node 22 下独立执行（不要并行写共享测试库）：

```sh
source "$HOME/.config/flowcube/dev-env.sh"
node --test tests/security-print-remediation.test.js
```

使用主代理已经验证归属且完成迁移的本批测试配置，配置值不回显：

```sh
FLOWCUBE_TEST_ENV_FILE=/tmp/flowcube-security20261006-253ed028/.env.test node tests/security-print-credentials.smoke.test.js
FLOWCUBE_TEST_ENV_FILE=/tmp/flowcube-security20261006-253ed028/.env.test npm run smoke:print-queue
```

凭据影响的旧套件已适配同一 helper/真实注册及完整 claim → ack：`mainline`、`concurrency-guards`、`audit-remediation-security`、`print-barcode-void-receipt`、`pick-label-reprint-lifecycle`、`pack-done-replay`、`sale-commercial-lifecycle`、`product-finance-period`。`ownedPrintFixture` 同时为其余既有消费者注册并撤销自有站。保留业务断言与原专属库门；`pack-done-replay` / 商业生命周期等专批测试不得为了本轮通过而绕过历史固定库门。共享 `smokeTestKit` 用 `tests/helpers/printClientIdentity.js` 生成当前测试库限定的随机凭据，禁止生产调用。旧套件更广兼容性结果由主代理统一报告。

根 `test:security-scan-remediation` 包含离线守卫，`smoke:security-scan-remediation` 包含新 HTTP smoke，package/CI 接线由主代理负责。未执行浏览器 GUI、PDA 真机、Electron 安装包、系统 safeStorage 实机、Windows/Unix 物理出纸或生产验证。这些证据不由函数、虚拟 RAW 或 HTTP/DB 的通过替代。
