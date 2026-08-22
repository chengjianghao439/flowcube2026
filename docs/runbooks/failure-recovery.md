# 故障恢复 Runbook（2026-08-22）

> 目标：生产服务器（`root@47.93.228.251`，项目 `/opt/flowcube`，SSH alias `flowcube-prod`）常见故障的
> 快速恢复指引。先看症状 → 按对应小节处理。所有改动只通过部署链路（main）上服务器，**不要直接在服务器上改代码**；
> 紧急情况下也请先按本节步骤恢复，恢复后把修复落到代码再部署。

## 0. 通用原则

- **monitor 告警会持续重提醒**：monitor.sh 每 5 分钟检查一次，持续异常按 `REMIND_HOURS`（默认 24h）反复推钉钉，
  不会只响一声。看到「仍未恢复」类告警时，说明故障从上次提醒到现在一直没好，**先当故障还在处理**。
- **告警去抖**：只有「正常→异常」和「异常→恢复」才通知，其余每 5 分钟的检查静默。所以收到异常告警后 5 分钟内
  没有恢复通知 = 故障持续。
- **先看日志再动手**：`docker compose logs --tail=200 <svc>` 是第一步，别直接重启（会丢失现场）。

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

恢复策略（按优先级，从代价小到大）：

1. **容器内 InnoDB 自恢复**：MySQL 启动时自动跑 redo log 恢复，通常自己就好。先给足时间（大库可能几分钟），
   别急着做任何删除。
2. **用最近一次备份重建**（每日 02:00 自动备份，保留 14 天，见 backup-db.sh）：
   ```bash
   # 停掉后端避免写入半残库
   docker compose stop backend
   # 找到最新有效备份（体积 ≥1KB 且 gzip 完好）
   ls -lt /opt/flowcube/backups/flowcube_*.sql.gz | head -5
   # 稳妥做法：先让临时容器把备份导入，验证无误再切生产（restore-check.sh 就是干这个的）
   bash scripts/restore-check.sh <最新备份>        # 通过 = 备份可恢复
   # 替换数据卷（先备份坏卷，万一新库还有问题可回查现场）
   docker compose stop mysql
   docker volume rm flowcube_mysql_data            # 注意：volume 名以 docker volume ls 实测为准
   docker compose up -d mysql                      # 空卷首次启动会建空库（不会自动跑迁移！）
   docker compose exec -T backend npm run migrate  # 手动补齐表结构（部署链路才会自动迁移）
   # 再导入备份数据（注意先建好表结构再灌数据，或用含 CREATE TABLE 的完整备份）
   gunzip -c /opt/flowcube/backups/flowcube_XXX.sql.gz | docker exec -i flowcube-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <库名>
   # 启动后端并验证
   docker compose up -d backend
   curl -fsS http://127.0.0.1:3000/api/health
   ```
   > ⚠️ **恢复后必须跑一致性检查**：`docker compose exec backend npm run resync:inventory-stock`
   > 与 `GET /api/inventory/check-consistency`（缓存列可能滞后），确认库存缓存与容器一致再放业务。

3. **实在没有可用备份**：联系开发从最近一次 `restore-check` 记录 / 服务器 MySQL 的 binlog 尽力找回。

---

## 2. Caddy 挂了 / 证书过期

### 症状

- monitor 告警「公网探测 https://jixuflow.com/api/health HTTP xxx」——注意回环检查（第 3 项）是通的，
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
#    - Let's Encrypt 限流（同一域名短期内申请太多次）→ 等重试，或临时改用自签证书（见下）保通
#    - 系统时间漂移 → date 对比，差太多会直接拒 ACME
#    - DNS 解析异常 → dig jixuflow.com 确认 A 记录指向本机公网 IP

# 3. Caddy 不内置 certbot；如需手动签发/排查可用系统 certbot（若已安装）
certbot certificates 2>/dev/null || echo "本机未装 certbot，Caddy 自理证书"
```

### 自签证书临时重签（应急兜底，保 HTTPS 可用）

桌面端/PDA 对自签证书有白名单支持（`main.js` 的 `certificate-error` 处理），临时换自签证书业务可继续：

```bash
# 生成自签证书（有效期按需，如 90 天）
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /etc/caddy/jixuflow.key \
  -out  /etc/caddy/jixuflow.crt \
  -days 90 -subj "/CN=jixuflow.com"
# Caddyfile 里临时把站点 tls 换成自签：
#   jixuflow.com {
#       tls /etc/caddy/jixuflow.crt /etc/caddy/jixuflow.key
#       ...
#   }
systemctl reload caddy
# 验证
echo | openssl s_client -servername jixuflow.com -connect jixuflow.com:443 2>/dev/null | openssl x509 -noout -dates
```

> 自签只是应急，恢复正式证书后立即改回 Caddy 默认（自动 ACME）。

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
  已提交但结果未知的，恢复网络后先查回执（`GET /api/system/request-status/:key`）再回查业务状态兜底。
- 现场操作不会因为后端重启丢数据：所有写操作走事务 + 幂等键（`X-Request-Key`），重试是安全的。
- 若后端长时间不可用，桌面端只是「建单/查单」功能用不了，已登录会话（JWT 7 天）会保持，恢复后无需重登；
  PDA 设备会话有自动续期，恢复后自动恢复。

---

## 4. 磁盘将满应急

### 症状

- monitor 告警「磁盘使用率 ≥85%」（`DISK_THRESHOLD` 可调）
- 数据库备份开始失败（`backup-db.sh` 的 fail 钉钉），或 MySQL 写不进去（表空间满）

### 应急顺序（从安全到激进）

```bash
# 0. 先看大头
df -h /
du -sh /opt/flowcube/* 2>/dev/null | sort -rh | head -10

# 1. 日志轮转检查：docker-compose.yml 已给 mysql/backend/frontend 配 json-file 50m×3，
#    但存量历史日志要手动收敛
docker system prune -f --volumes   # ⚠️ 会删未使用数据卷，先确认 loki_data 等被引用后再执行
docker system prune -af            # ⚠️ 会删未使用的镜像/缓存，谨慎（部署后镜像缓存重建成本高）
# 更稳妥的增量清理：
docker image prune -f              # 只删悬空镜像
docker builder prune -f            # 只删构建缓存

# 2. 备份保留缩短：默认 14 天，紧急时删旧备份最快
find /opt/flowcube/backups -name 'flowcube_*.sql.gz' -mtime +3 -delete   # 留最近 3 天
# 或临时改 KEEP_DAYS 环境变量让 cron 下次自动收紧（改 .env 或 install-cron 的 cron 行）

# 3. /versions 清理（桌面端历史安装包目录，nginx 挂载的 downloads 根下）
ls -lt /var/www/flowcube-downloads/versions/ | head   # 确认结构
# 保留最近几个版本，删除更老的：
find /var/www/flowcube-downloads/versions -type f -mtime +60 -delete 2>/dev/null || true
# ⚠️ 绝不动 /var/www/flowcube-downloads/latest.json（桌面更新唯一入口）与 current/ 下的当前包

# 4. MySQL 自身占空间的表（如日志类）若有归档需求再处理；没有就到此为止
```

### 预防

- 备份每日 02:00 自动跑并校验，`daily-report.sh` 每日 09:00 报告体积；只统计 ≥1KB 的有效备份。
- 监控阈值 85% 已比 Docker 容器日志上限（50m×3）留了余量；若频繁触顶，考虑迁移数据盘或加容量。

---

## 5. 恢复后的验证清单

- [ ] `curl -fsS http://127.0.0.1:3000/api/health` 与 `https://jixuflow.com/api/health` 都 200
- [ ] `docker compose ps` 三容器（mysql / backend / frontend）均 Up，重启计数不再增长
- [ ] monitor 推送了「✅ 服务已恢复正常」钉钉（说明状态文件已回到 ok）
- [ ] 若涉及库存：跑 `resync:inventory-stock` 或 `GET /api/inventory/check-consistency`
- [ ] 若涉及备份恢复：`bash scripts/restore-check.sh` 通过（表数 + 关键表行数 + 数据新鲜度）
- [ ] 若动过证书：`echo | openssl s_client -servername jixuflow.com -connect jixuflow.com:443 2>/dev/null | openssl x509 -noout -enddate`
