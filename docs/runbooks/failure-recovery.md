# 故障恢复 Runbook（2026-08-22）

> 目标：生产服务器（`root@47.93.228.251`，项目 `/opt/flowcube`，SSH alias `flowcube-prod`）常见故障的
> 快速恢复指引。先看症状 → 按对应小节处理。所有改动只通过部署链路（main）上服务器，**不要直接在服务器上改代码**；
> 紧急情况下也请先按本节步骤恢复，恢复后把修复落到代码再部署。

## 0. 通用原则

- **monitor 告警会持续重提醒**：monitor.sh 每 5 分钟检查一次，持续异常按 `REMIND_HOURS`（默认 24h）反复推钉钉，
  不会只响一声。看到「仍未恢复」类告警时，说明故障从上次提醒到现在一直没好，**先当故障还在处理**。
- **按故障去重**：新故障、等级变化、逐项恢复都会通知；持续同一故障按默认24小时重提醒。
  发送成功后才确认，发送失败下轮重试。没有恢复通知需继续核对，不能仅凭消息缺失断言故障状态。
- **先看日志再动手**：`docker compose logs --tail=200 <svc>` 是第一步，别直接重启（会丢失现场）。
- **慢查询数量属于性能摘要**：`monitor.sh` 按当前慢日志UTC `# Time:`统计最近24小时，进入日志与日报，不按数量即时报警；
  旧日志保留作调查证据。日志不可读取或时间格式不受支持时仍告警。
  不要通过清空慢日志或手改 `.monitor.state` 来消除提醒；先核对近期数量、服务健康与负载。

---

## 1. MySQL 挂了怎么办

### 症状

- monitor 钉钉告警「MySQL 无法连接」「容器 flowcube-mysql 异常」；或后端报 `ECONNREFUSED` / `Can't connect to MySQL server`
- 前端大量接口失败、登录都进不去

### 恢复步骤

```bash
# 1. 查容器状态
docker compose ps           # mysql 行是否为 Up？Restarting 反复出现说明 crash-loop
docker compose logs --tail=200 mysql

# 2. 重启 mysql 容器（先试常规重启，多数情况够用）
docker compose restart mysql
# 等 30 秒后验证
docker compose ps

# 3. 验证能真实应答（healthcheck 的 mysqladmin ping 是浅探，最好做一次查询）
docker exec flowcube-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT 1"   # 密码在根 .env 里

# 4. 若起不来：看容器日志定位原因
docker compose logs mysql | tail -100
# 常见原因与处理：
#   - 磁盘满 → 见第 4 节磁盘应急
#   - 权限/损坏 → 见下方「数据损坏恢复」
#   - init 报错 → 检查 /etc/mysql/conf.d/slowlog.cnf 挂载与迁移记录
```

### 数据损坏恢复（用备份）

1. **先隔离写入、保留原实例。** 可用时让 InnoDB 完成常规 redo 恢复。遇到疑似数据损坏、迁移失败或目标不明，停止业务入口及后端、调度器和独立写入进程，核对应用确实停写。按部署锁和事故窗口同步执行，保留原 MySQL 容器、挂载和数据卷、日志、实际镜像、当前业务和迁移状态。疑似坏盘优先保留证据并交数据库管理员处置。
2. **记录实际来源。** 使用部署实际的 Compose 项目和覆盖配置，`docker compose ps -a -q mysql` 可定位停止的容器。用 `docker inspect --format '{{.Id}} {{.Image}} {{json .Mounts}}' <容器ID>` 记录容器 ID、镜像 ID、挂到 `/var/lib/mysql` 的卷名或 bind mount 路径。对该镜像查 RepoDigest、架构和已验证的可取回副本；可连接时通过受保护的已认证会话记录 `SELECT @@server_uuid, VERSION(), DATABASE();`。对照备份回执的 SHA256、源 UUID、版本、库名与迁移状态，记录备份起止或可证明的业务数据截止时间。文件修改时间仅用于判断新鲜度。源不可查时记录不确定项。
3. **先做独立演练，再另建可保留的恢复目标。** `RESTORE_IMAGE=<已核实镜像> bash scripts/restore-check.sh <备份.sql.gz>` 在关网临时容器导入并核表数及关键表行数，运行结束清理其专属测试卷。需要业务验收或接管时，另以新 Compose 项目、新的持久卷和隔离网络创建 MySQL，核对其挂载与源卷不同、UUID 与源实例不同，核对实际镜像 ID 和版本。仅将此卷挂到恢复实例。用授权的恢复账号先建无对象的目标 schema，再把完整逻辑备份导入一次，保留归档原件。导入在启用 `pipefail` 的管道中使用 [restore-check.sh](../../scripts/restore-check.sh) 同样的触发器终止符规范化，MySQL 出错即停止。确认导入之前无需先建业务表或补迁移。备份缺失或验证失败时，另核对可用的历史备份、异地副本或可验证的 binlog 时间点。
4. **按库的来源选择入口。** 已有库用标准 migrate，保留其迁移和业务事实。零对象的首次安装才执行 `bootstrap-new-database.js`，从经批准的种子建立迁移 296 所需的 13 角色基线。完整备份导入后属于已有库，先核源对应的迁移回执、实际表与触发器、296 角色修订和候选镜像写入契约，再按需在隔离副本执行标准 migrate。遇到 296 严格基线失败或任何部分 DDL，保持停写，保留失败 SQL、回执及现场，交负责人确认后向前修复。详细入口见 [部署说明](../DEPLOY.md#数据库入口与独立恢复)。 候选迁移器报 `MIGRATION_ATTEMPT_UNRECONCILED` 时，记录 `db_migration_attempts` 的文件名、开始时间与迁移前备份。在独立副本比对实际 DDL、数据和回执，按核准方案向前处理。禁止盲目重跑或手工改回执。
5. **在原实例停止的情况下验收恢复实例。** 使用只接恢复库的隔离应用验证登录、销售单详情、容器余量与库存缓存一致性、对账导出及金额，保存对照结果。记录事故停写、导入起止、业务验证完成和服务恢复时间，并记录备份覆盖到的数据时间与可能遗漏的区间。库存有差异先留证，不在验收中自动同步缓存。通过检查并经负责人确认切换后，先核应用实际连接的身份、`/api/ready` 以及用户侧只读业务，再解除停写。原卷、原镜像和备份保留到故障复盘和单独的清理确认。

### 恢复小满及原业务回执

1. 从本地备份或已获准的异地副本选择同时间戳的 SQL、小满归档和回执。运行 `node scripts/lib/backup-pair.cjs verify <备份根目录> <YYYYMMDD_HHMMSS>`，核对两份文件身份、字节数和摘要。
2. 保留原小满卷及 MySQL 原卷；应用与调度保持停写。按前节在独立目标导入 MySQL。在新小满卷的路径中，以后端实际运行账户解压、恢复仓库。以下命令在独立目标上执行，恢复工具先完成校验，再写入空目录。
   ```bash
   set -o pipefail
   gzip -dc <小满归档路径> | node scripts/lib/assistant-backup.cjs restore <独立空目标目录>
   ```
3. 启动接入恢复数据库与新小满卷的隔离应用，核对本人任务、其他账号访问拒绝和当前权限变化后的拒绝。按原请求键确认 MySQL 的业务回执，涉及快照时间差或回执过期时先人工核对单据及库存／账款事实；不自动重放写入。归档、回执与停写/恢复时间加入事故记录，通过业务验收后才接管。

---

## 2. Caddy 挂了 / 证书过期

### 症状

- monitor 告警「公网探测 HTTP xxx（实际地址为 /api/ready）」——注意回环检查（第 3 项）是通的，
  说明问题在公网链路：Caddy、DNS 或证书
- 浏览器访问 https://jixuflow.com 报证书错误 / 连接拒绝

### Caddy 挂了

```bash
systemctl status caddy          # 看状态与最近日志
journalctl -u caddy --no-pager -n 100
systemctl restart caddy         # 常规重启
systemctl reload caddy          # 只改配置时用 reload（不中断连接）
```

### 证书过期 / 续期失败排查

Caddy 用内置 ACME（Let's Encrypt）自动续期，正常提前 30 天就续好了。monitor 的证书检查（剩余 <14 天告警）
连续几天告警 = 续期链路有问题：

```bash
# 1. 看 Caddy 日志里 ACME 报错（order failed / 429 rate limit 等）
journalctl -u caddy --no-pager | grep -iE 'acme|ocsp|certificate' | tail -50

# 2. 常见原因与对策：
#    - 域名的 80/443 端口被防火墙挡（ACME http-01 验证需要）→ 检查 Caddyfile 的 global 配置与防火墙
#    - Let's Encrypt 限流 → 按 ACME 返回的重试时间处理，或部署另一受信任 CA 签发的有效证书
#    - 系统时间漂移 → date 对比，差太多会直接拒 ACME
#    - DNS 解析异常 → dig jixuflow.com 确认 A 记录指向本机公网 IP

# 3. Caddy 不内置 certbot；如需手动签发/排查可用系统 certbot（若已安装）
certbot certificates 2>/dev/null || echo "本机未装 certbot，Caddy 自理证书"
```

### 恢复可信证书后验证

桌面端已移除按 IP 放行任意证书的旧白名单。证书过期、名称不匹配或证书链不可信时应拒绝连接和更新下载，不能换任意自签证书或禁用校验“保通”。修正 DNS、系统时间、ACME 端口或部署可信 CA 签发的完整证书链后，再验证：

```bash
curl --fail --show-error https://jixuflow.com/api/health
openssl s_client -verify_return_error -verify_hostname jixuflow.com \
  -servername jixuflow.com -connect jixuflow.com:443 </dev/null
```

受管私有 CA 必须由用户的设备管理流程建立系统信任；当前应用没有按主机绕过证书验证的例外。

---

## 3. 后端挂了，桌面端 / PDA 怎么办

### 症状

- monitor 告警「后端健康检查 HTTP xxx」；网页打不开 / 接口全失败
- 桌面端 / PDA 现场作业异常

### 恢复步骤

```bash
docker compose ps                       # backend 是否 Up / Restarting（crash-loop）
docker compose logs --tail=200 backend  # 看启动报错（DB 连不上 / 迁移失败 / 端口占用等）
docker compose restart backend
curl -fsS http://127.0.0.1:3000/api/health
```

### 客户端 fail-safe 行为（重要，先告诉现场）

- **桌面端自动更新与业务作业完全解耦**：`updateCheck.js` 的整个更新检查包在 try/catch 里——后端更新接口
  请求失败（超时、404、非 200）只 `console.error` 后直接返回，**不弹窗、不阻塞**；业务功能照常跑。
  所以后端挂了不会拖垮桌面端作业，最多是没更新提示。
- **PDA 关键作业不做离线自动重放**（刻意设计）：断网时 `useCriticalPdaAction` 直接阻断提交，防止重复；
  已提交但结果未知的，恢复网络后查询本人原键原动作回执（`GET /api/system/request-status/:key`）。任务当前进度、旧收货箱数或相同盘点总数不能证明本次提交成功。
- 已支持原操作恢复的 PC 手动出库、PDA 收货和盘点保存，在发送前持久化完整正文、原键及账号/服务器身份；超时、5xx、查不到、仍处理和查询失败均保留。只有原 success/failed 或首次明确4xx拒绝才能结束该次未决操作。查不到且原意图未过七天保留期（预留两分钟）、身份及正文完整时，员工可显式按原键原正文重试；不能改量或换键。其它关键 PDA 操作仅查询原结果，不由这个通用恢复入口自动执行。
- 本地存储、Web Locks及所需WebCrypto不可用时不发送新的关键写入；原记录损坏或丢失须人工核对。删除浏览器数据、换客户端或origin可能丢失恢复证据，不能承诺所有现场写入都可安全重试。
- 恢复还需当前有效账号、权限、服务器及PDA原设备身份。认证或设备会话已失效时需沿原机制重新登录/绑定，不能承诺后端重启后永不重登。

---

## 4. 磁盘将满应急

### 症状

- monitor 告警「磁盘使用率 ≥85%」（`DISK_THRESHOLD` 可调）
- 数据库备份开始失败（`backup-db.sh` 的 fail 钉钉），或 MySQL 写不进去（表空间满）

### 应急顺序

先用有时限的小范围查询确认空间、负载与云盘指标。2026-09-04 故障中云平台确认 I/O 受限；此时不要运行 `docker system df`、全目录 `du` 或 prune 增加盘压力。磁盘使用率和 IOPS 是不同指标，空闲容量足够也不能排除 I/O 饱和。

```bash
timeout -k 5 10 df -h /
cat /proc/loadavg
cat /proc/pressure/io
```

发布期间保持旧应用镜像和全部数据库卷。新发布器空间不足直接失败，门禁不自动删除任何镜像、缓存或卷。Docker 客户端超时不保证 daemon 内部任务已经停止；如果 Docker 管理查询也超时，先检查云平台磁盘延迟/限流和实例状态，避免重复派生同类请求。

需要清理时，先在维护窗口列出具体对象、确认数据库备份及应用回退镜像，再取得对应删除授权；不要使用 `docker system prune --volumes` 一类范围不明的应急命令。备份保留策略默认 14 天，不因空间告警自行缩短。已有云盘容量未被分区使用时，可按核验后的分区表评估扩容，不能直接套用另一台机器的设备路径。

### 预防

- 备份每日 02:00 自动跑并校验，`daily-report.sh` 每日 09:00 报告体积；只统计 ≥1KB 的有效备份。
- 监控阈值 85% 已比 Docker 容器日志上限（50m×3）留了余量；若频繁触顶，考虑迁移数据盘或加容量。

---

## 5. 恢复后的验证清单

- [ ] `curl -fsS http://127.0.0.1:3000/api/health` 与 `https://jixuflow.com/api/health` 都 200
- [ ] `docker compose ps` 三容器（mysql / backend / frontend）均 Up，重启计数不再增长
- [ ] monitor 推送了「✅ 服务已恢复正常」钉钉（说明本轮异常已全部解除；状态文件当前观察为空且推送已确认）
- [ ] 若涉及库存：用 `GET /api/inventory/check-consistency` 核对容器余量与库存缓存，记录差异并经确认后处理。
- [ ] 若涉及备份恢复：`bash scripts/restore-check.sh` 通过（备份文件时间 + 导入 + 表数 + 关键表行数），并有原实例停止后独立恢复目标的业务验收记录。自动选最新文件时默认最多 48 小时，可用 `BACKUP_MAX_AGE_HOURS` 调整；显式传入历史文件时仅提示过期并验证其恢复能力。销售单多久没有新增与备份是否新鲜无关。
- [ ] 若动过证书：`echo | openssl s_client -servername jixuflow.com -connect jixuflow.com:443 2>/dev/null | openssl x509 -noout -enddate`

### 2026-10-13 云端第二批恢复补验与容量边界

关键终态标记的安全保留、预算和时钟封存见[前端/PDA规范](../frontend-pda-conventions.md)。本次窄盘点恢复使用真实页面hook的`requestAction: stockcheck.scan`，独立首进程POST提交成功后丢弃响应、第二全新进程仅GET原结果；其SQL与零POST事实另见第二批交接证据，不以旧[1,1]夹具代替新[2,0]提交。实际设备quota耗尽、PDA WebLocks/WebCrypto、云端GUI、Windows及纸张均仍未验证；不删除pending、不重发新key、不改变后端去重保留。普通销售未知意图恢复S2未修复，relatedEvents指定异常历史权限缺口与受阻探针仍保持原边界。

## 2026-10-13 第五批采购未知结果

请购创建或plan.convert丢响应时保留原键和查询身份，先在原账号/服务器查询原动作回执。重挂只有查询；原提交页面仅在持完整原正文、先查not_found且原创建时刻七日减两分钟内可显式原键重试。not_found、超期、旧PR缺完整摘要、同键不同正文/selection、scope被撤均不是未执行证明；保留记录并核对原PR/plan/PO，不能换键或用当前草稿冒认原成功。服务端沿既有七日临时回执，不新增永久证明或自动修写历史。
