# 安全扫描会话与导入修复（2026-10-06）

基线 `14e97aa`；独立工作树 `security-scan-remediation`，分支 `codex/security-scan-remediation`。对应 `output/security-scan-2026-10-06/findings.json` 的 1-based 项目 #10、#13、#20、#22、#23。以下是本地实现与测试证据，提交、推送与部署状态由本批总报告核对。

## 会话边界

- #10：每次登录创建独立 `familyId`。refresh 轮换保留同一族；签名、当前用户版本与活跃族已验证后，旧 JTI 已作废或被清理都按重放处理，**先提交族及其全部 refresh 的撤销，再返回 `AUTH_REFRESH_REPLAY`**。提交后记录专用 `refresh_replay_detected` 安全审计；审计失败不回滚撤销，也不替换重放的 401。新子代 access/refresh 随即失效；其他设备的族保持有效。再次使用已撤销族返回 `AUTH_REFRESH_INVALID`，不会继续撤销别的族。
- #22：有效 logout 在用户行锁事务中撤销当前族的 access 与 refresh；其他设备保持登录。有效签名、账号版本与所属活跃族都匹配的**已轮换或已清理祖先**也可撤销当前族，覆盖前端捕获旧 refresh 后与续期并发的退出。已撤销族、无效、过期和 access 冒充 refresh 的退出维持幂等响应，并且不产生已验证业务日志身份。
- #23：用户管理禁用在原有锁定目标事务中递增 `token_version` 并撤销全部族和 JTI。重新启用不降低版本、不恢复旧记录。未传 `isActive` 时保持锁定读取的原值。
- #20：未知账号、禁用账号和错误密码都执行一次 bcrypt 检查；未知账号用固定 cost-10 dummy hash。三者对外统一 `401 AUTH_INVALID_CREDENTIALS` / `账号或密码错误`，真实原因仅保留在专用安全审计。登录签发前再锁定用户并检查启用状态与密码快照，防止并发禁用或重置之后按旧密码快照签发会话。

迁移 `276_auth_session_families.sql` 新增族表及 `refresh_token_sessions.family_id` 和相关索引，采用幂等 DDL。access 认证从族表读取实时撤销状态。升级前无 `familyId` 的 access/refresh 要求重新登录；不会保留可绕过退出撤销的 legacy access 路径。个人改密码继续递增账号版本，并在同事务撤销族与 JTI；管理员重置仍按账号版本拒绝所有旧票据。

`refresh-session-cleanup` 保持原有 JTI 清理条件，然后只删除创建已超过七天且 `NOT EXISTS` 任何 refresh 行的族；已作废 refresh 行同样阻止清理，近期空族也保留。已清理祖先的有效签名重放会继续撤销活跃后代。

登录/退出业务日志仅使用已验证 `operationActor`。失败登录、公开续期及无效/重复退出不写通用业务日志；登录与续期的安全审计保留。通用日志接点属于本批根代理修复。

## 导入预算

`importBudget.js` 在 API 进程只读取有界 ZIP 中央目录；`importParseWorker.js` 在独立进程完成解压、XML/CSV 预检与 ExcelJS 解析。所有预算验证通过并完整取回第一张表的行数据之后，service 才能取号、建导入批次、读业务数据或写入。

| 预算 | 上限 |
|---|---|
| 上传文件 | 5 MiB（原 multipart 限制与 service 双层） |
| ZIP 条目 | 256；拒绝多卷、ZIP64、加密、不支持的算法、重复/穿越名称、重叠区间和不一致本地头 |
| 声明及实际展开 | 单条目 8 MiB、合计 20 MiB，单条目及累计压缩比 100 |
| 工作表 | 常规 1 张，库存模板允许 2 张（含参考表） |
| 行数 | 每表最多 1001 行，含表头，即每批最多 1000 条数据 |
| 列数 | 商品 10、库存 3、客户 7（含选填地址，旧六列兼容）、供应商 8、价格表明细 3 |
| 单元格 | 各实体 `1001 × 列数 × 允许工作表数`；稀疏坐标也必须在行列预算内 |
| 字符串 | 单格 2048 字符，总计 2 MiB（UTF-8） |
| 解析 | 5 秒墙钟期限，子进程 V8 old-space 上限 96 MiB；展开字节限制同时约束外部 Buffer |
| 并发 | 每 API 进程最多 2 个 HTTP 导入，multipart 内存分配前占位；解析服务也最多 2 个子进程 |

预算失败返回 `400 IMPORT_BUDGET_EXCEEDED`；格式损坏为 `400 IMPORT_FILE_INVALID`；并发忙为 `429 IMPORT_BUSY`。超时必须结束本任务子进程并等待退出后释放解析槽位。子进程启动失败的 `error/close`（没有 `exit`）也经幂等收尾清除计时器、拒绝请求并释放槽位。HTTP 槽位在 finish/close/abort 释放。CSV 先流式验证记录数量、列数和字符串，再沿用 ExcelJS 原来的数值/日期/错误转换；客户和供应商继续保留原词素，`01` 等值不会被转换为合法结算枚举。

ZIP 元数据不仅做声明预检：子进程以 `maxOutputLength` 限制实际 inflation，核对实际长度与 CRC，随后检查 worksheet dimension/row/cell XML，再加载模型并复核所有工作表。这使中央目录谎报尺寸、稀疏超大坐标及多余工作表在任何业务写入前被拒绝。业务字段无效时原有逐行错误回执保持原语义。

## 验证记录

Node `v22.23.2`，按项目 `dev-env.sh` 加载。首次离线会话测试 4/4 失败（自然退出 1）：退出后原 access 仍返回 200、重放后子代继续续期、禁用版本未递增、禁用登录独有 403；首次导入测试 5/5 失败（自然退出 1）：行/列/字符串/高比率/稀疏坐标没有整单预算拒绝。

离线 `node --test tests/security-session-family.test.js tests/security-import-budget.test.js` 为 16/16，通过且自然退出 0；scheduler 清理先红 1/1（退出 1），收口后会话+清理 6/6 自然退出 0；后续 CSV 流式预检收口后，导入 11/11 自然退出 0。覆盖真实 auth/users 函数、JWT/bcrypt、隔离 HTTP 中间件；数据库由内存 SQL 适配器代替，因此该证据不等于真实事务验收。

独立复审的轮换/清理祖先退出与 replay 专用审计新增三条反例先红（5 通过 / 3 失败，自然退出 1），修复后会话 8/8 自然退出 0。真实 `fork` 指向不存在的 `execPath` 复现启动错误不 settle、槽位残留，先红自然退出 1；补 `close` 收尾后两个失败启动均正确拒绝，后续真实解析进程成功。最终会话 8、清理 1、导入 12，共 **21/21，无 skip，自然退出 0**，日志 `/tmp/flowcube-security-session-import-final.log`。

导入覆盖正常三类模板、结算原始词素、1000 数据行/2048 字符精确边界、257 ZIP 条目、实际展开尺寸伪造、两级并发、超时释放、HTTP 完成/中止释放。会话覆盖当前设备退出/其他设备继续、子代撤销、禁用/重新启用、三类失败登录的相同响应与一次 cost-10 密码检查、已清理祖先重放。

一次新增 HTTP 并发测试的夹具 finally 重复发送响应，出现 `ERR_HTTP_HEADERS_SENT` 并挂起；仅停止了本轮所属测试进程，修正幂等收尾后重新自然退出 0。该被终止运行未计为通过。

真实 HTTP/MySQL 会话专项由根代理在统一新建独立测试库串行执行，初版 1/1 自然退出 0（约 781ms）；新增延迟重放与精确清理后的版本也 1/1 自然退出 0（约 905ms，`/tmp/flowcube-security-session-db-final.log`）。最终新增祖先退出、并发 refresh/logout 及 replay 审计的版本已由根代理串行复跑：会话子测试 1/1（约 1683ms），与范围子测试合计 2/2 无 skip，随后打印 11 场景通过，完整命令自然退出 0，日志 `/tmp/flowcube-security-final-smoke-security-scan-remediation.log`。两个既有 auth 回归随后由本子任务串行执行，均自然退出 0。详细入口与当前证据：

- `node --test tests/security-session-family.smoke.test.js`：真实 HTTP/MySQL，包含同 refresh 并发轮换 1 成功/1 重放、轮换/清理祖先退出与并发 refresh/logout、DB 撤销已持久化、子代立即失效、其他设备保持、禁用重新启用、专用 replay 审计与 legacy 升级边界。
- `node tests/auth-session-remediation.smoke.test.js`：本轮脚本完整通过，日志 `/tmp/flowcube-security-auth-session-existing.log`；可信成功身份、匿名业务日志零写入、专用安全审计与凭据脱敏。
- `node --test tests/auth-token-remediation.smoke.test.js`：本轮 3/3 无 skip，日志 `/tmp/flowcube-security-auth-token-existing.log`；密码重置并发和上一把密钥签发的带族 refresh 退出。
- `node tests/masterdata-import.smoke.test.js`：原有客户/供应商 multipart 导入词素与业务结果回归。本次将旧手签无族 JWT 夹具替换为真实 HTTP 登录及本轮族/JTI 清理，根代理最终串行实跑自然退出 0，日志 `/tmp/flowcube-security-final-smoke-masterdata-import.log`。CSV 各持久化 5 条合法枚举、拒绝 10 条非法原词素；XLSX 各持久化 1 条合法枚举、拒绝错误单元格；模板下载与本轮资源清理通过。

打印交叉接口 `frontend/src/api/client.ts` 在 `PRINT_CLIENT_CREDENTIAL_INVALID` 的 401 上返回结构化错误，由桌面桥处理注册提示，保持 ERP 会话；其他认证 401 继续原续期/退出逻辑。真实 Axios 拦截器回归先红两条（误续期三请求或无 refresh 时误退出，自然 1），修复后 `client.refresh.test.ts` 全 **21/21，自然 0**；日志 `/tmp/flowcube-security-print401-green.log`。相关前后端受影响文件 ESLint 及全工作树 `git diff --check` 自然退出 0。

新增离线测试已接入 `test:security-scan-remediation` 及 CI 静态 job，真实专项已接入 `smoke:security-scan-remediation` 及 MySQL job；前端拦截器回归沿用 CI `test:unit`，原 masterdata-import 保留在既有烟测矩阵。此处核对的是源码接线与本地实跑，不代表 GitHub CI 已运行。迁移幂等/schema 名称列序及共享主题文档由根代理统一核验；族清理实现和窄说明已由本子任务按授权扩展完成。本子任务未操作浏览器、未暂存/提交/推送/发版。

## v0.13.0 整合复核（2026-10-07）

将 go-live 的 partyProfile 合并到同一解析入口，继续在取号和任何业务查询之前完成整单预算检查。客户增加第七列地址，供应商仍为八列；两类导入透传 `preserveRowNumbers`，在有界数组中保留 CSV/XLSX 空行后的来源行号，不改变其它实体的紧凑行合同。客户/供应商名称、联系人、电话、地址沿统一 Unicode 长度及电话字符校验，结算方式继续保留原词素。

新增真实 worker 反例先红 2/2（客户第七列被拒、空行后第4行被压成第2行），自然退出1；收口后 `security-import-profile-integration`、原预算测试与 `party-profile` 合计 **48/48、无 skip、自然退出0**。日志 `/tmp/flowcube-release-import-integration-{red,green}.log`。恢复请求的 `automaticReplay=false` 与打印凭据401同时保留；新增两条反例先红，随后客户端 refresh/base-url/disposal **31/31、自然退出0**，日志 `/tmp/flowcube-release-client-integration-{red,green}.log`。此次整合离线验证未连接数据库，前述真实SQL证据属于安全分支整合前的运行；最终发布树数据库验收由根代理另行记录。
