# 部署磁盘预检：静默失败导致连续 3 轮部署无法定位（2026-09-19）

## 现象

2026-09-19 11:04 起，`Deploy Browser App` 连续三轮失败（`8a2a748` 11:04、`d7cb1cc` 11:18、`a654aac` 11:28），
失败形态完全一致：

```
deploy  Deploy backend and frontend on server  ... ##[endgroup]
deploy  Deploy backend and frontend on server  ... ##[error]Process completed with exit code 1.
```

`##[endgroup]`（GitHub 打印该步骤脚本内容结束）之后**没有任何一行命令输出**，3~4 秒后即 exit 1。
对照成功轮次：`ea13046`（10:56）成功，之前 `48bdb07`、`9536fa6`、`7f014a7`、`cad79be`、`c53005a` 均成功。

## 诊断

失败点必须落在脚本的**第一条命令**之前或之上，因为：

- 该步骤后续要 `scp` 上传镜像归档（上限 1800 秒）与远程 `server-update.sh`（上限 2400 秒），
  4 秒不可能走到它们；
- `flock -w 1800` 会等待而不是立即失败，`exec 9>` 失败会有 `No space left on device` 之类的 stderr；
- SSH 认证失败会打印 `Permission denied (publickey)`，而日志里**一行都没有**。

第一条命令正是上传前的磁盘预检：

```bash
timeout -k 5 30 ssh … "test $(df -Pm /tmp | awk 'NR==2 {print $4}') -ge 6144 \
  && test $(df -Pm /opt/flowcube | awk 'NR==2 {print $4}') -ge 6144"
```

余量不足时 `test` 返回 1 → ssh 返回 1 → `set -e` 立即终止。**该形态不产生任何输出**，因此「服务器磁盘不足」
与「SSH 连不上/密钥失效」在 CI 日志里完全无法区分——本次是靠逐轮对比成功/失败时间线才推断出结论。

10:56 成功、11:04 起全部失败，说明磁盘是在这两次之间掉到 6 GiB 以下的（很可能是前一次成功部署留下的
镜像归档/旧镜像所占）。

## 修复：预检必须自解释

`.github/workflows/deploy-browser.yml` 的 Deploy 步骤改为「先把余量存变量并打印，再判定」：

```bash
DISK_USAGE="$(timeout -k 5 30 ssh … "df -Pm /tmp '<APP_PATH>' | awk 'NR>1 {print $6, $4 \"MB\"}'")" \
  || { echo "::error::无法读取服务器磁盘余量（SSH 连接或认证失败），部署中止"; exit 1; }
echo "服务器可用空间（挂载点 可用）："
printf '%s\n' "$DISK_USAGE"
printf '%s\n' "$DISK_USAGE" | awk '
  NF < 2 { print "::error::服务器磁盘预检没有拿到可用空间，部署中止"; bad = 1; next }
  { mb = $NF; sub(/MB$/, "", mb)
    if (mb + 0 < 6144) { printf "::error::%s 可用 %s，低于部署预检下限 6144MB：请先清理服务器磁盘再重跑（不得清除回退镜像）\n", $1, $NF; bad = 1 } }
  END { exit bad ? 1 : 0 }'
```

门禁语义不变（仍是两侧都要 ≥ 6144MB、仍不自动 prune），但三种失败现在可区分：**磁盘不足**（打印各挂载点
实际余量）、**SSH 取不到**、**df 返回空/格式异常**。

### 已踩到的 awk 坑

第一版把 `NF < 2` 分支写成 `exit 1`：awk 的 `exit` 会先跳到 `END`，而 `END { exit bad ? 1 : 0 }` 又把它
覆盖成 0——**打印了 error 却 exit 0**，等于空输出被静默放行。本地边界测试时才发现（这正是「必须做破坏性/
边界验证」的又一实例）。现改为置 `bad = 1; next`，由 `END` 统一决定退出码。

## 验证

- 判定逻辑 5 例（本地 awk 直跑）：充足 → 0；/ 不足 → 1 且提示挂载点与余量；APP_PATH 不足 → 1；
  空输出 → 1；格式异常 → 1。
- **端到端 harness**：从 `deploy-browser.yml` 提取 Deploy 步骤的 `run` 块、替换 `${{ }}` 模板、
  用 stub `ssh`/`scp` 执行——充足场景整体 exit 0 并打印余量；余量不足 / SSH 失败 / df 空 三种场景
  均 exit 1 且各自命中对应提示。`bash -n` 通过。
- 机械守卫新增于 `tests/deployment-resources.test.js`（第 19 项）：断言必须打印余量、必须区分三类失败、
  `NF<2` 必须 `bad = 1; next`、不得退回 `test "$(df …)" -ge 6144`。
  **反向验证三例全部成立**：退回静默 `test`、把 `NF<2` 改回 `exit 1`、删掉 SSH 失败分支，均使测试失败。

## 当前影响

- **生产仍停在 `ea13046`（10:56 那次成功部署）**。之后的 `8a2a748`、`d7cb1cc`、`a654aac`、`0bce8f3`、
  `1c5ca52` 均未上线——不是坏版本上线，而是部署被预检挡在上传之前，线上服务未受影响。
- 两个前端改动（财务看板饼图 Top 8、本次预检可诊断性）已通过 Tests 与 Security Scan，
  等待磁盘恢复后随下一次成功部署上线。

## 实测数值（2026-09-19 11:50，`1c5ca52` 那一轮部署）

改造后的预检当场给出了确切原因，不再需要推断：

```
服务器可用空间（挂载点 可用）：
/ 6120MB
/ 6120MB
##[error]/ 可用 6120MB，低于部署预检下限 6144MB：请先清理服务器磁盘再重跑（不得清除回退镜像）
```

- `/tmp` 与 `/opt/flowcube` **同处根分区 `/`**，可用 **6120MB**——距上传门限只差 24MB。
- 服务器共有三道磁盘门禁、阈值不同：上传前预检 **6144MB**（`deploy-browser.yml`）、`docker load` 前
  **4096MB**（`scripts/server-update.sh`）、发布门禁 **4096MB**（`scripts/release-gate.sh`）。
  当前值高于 4096 那道、卡在 6144 这道，因此部署在**上传任何字节之前**就被拒绝。
- 容量增长来源：每轮成功部署都会 `docker load` 新镜像，并保留正在运行与回退用的镜像，旧镜像不自动清理；
  DB 备份由 `scripts/backup-db.sh` 按 `KEEP_DAYS`（默认 14 天）自动删旧，目录 `/opt/flowcube/backups`。

## 需要人工处理

本机**没有生产 SSH 私钥**（只配在 GitHub Secrets；`ssh root@jixuflow.com` 返回 `Permission denied`），
既无法只读确认占用构成，也无法清理。按既有规则，低磁盘时门禁**不自动 prune、不清回退镜像**，
必须人工判断后清理再重跑。建议的只读排查（不动任何数据）：

```bash
df -h /                                                       # 根分区余量
du -sh /opt/flowcube/backups                                  # 备份占用（超 14 天的会被自动删）
du -sh /var/www/flowcube-downloads /versions 2>/dev/null       # 历史安装包 / PDA 包
ls -lh /tmp/flowcube-images-*.tar.gz /tmp/flowcube-pda-bootstrap-*.sh 2>/dev/null  # 被取消 run 的残留
docker system df                                              # 镜像/缓存/卷占用
docker image ls --format '{{.Repository}}:{{.Tag}} {{.Size}} {{.CreatedSince}}'
```

可安全清理的是：`/tmp` 上历史 run 的归档残留、确认不再使用的历史版本安装包、**明确不再回退**的旧
`flowcube-*` 镜像。**正在运行与保留用于回退的镜像不得删除**（删之前先用 `docker inspect -f '{{.Image}}'`
对照当前 backend/frontend 容器与实际运行镜像 ID）；不要整体执行 `docker system prune`。

清理后重跑：`gh workflow run deploy-browser.yml --ref main`，或等下一次 push。

## 清理执行记录（2026-09-19，用户授权「顺便帮我清理一下服务器」）

只读排查确认 `/tmp` 里没有本轮 CI 归档残留，备份目录只有 22 份 5.2M（`backup-db.sh` 有 14 天自动清理），
apt 与家目录缓存可忽略；可回收的是三项：

| 目标 | 大小 | 依据 |
|---|---|---|
| `/tmp/flowcube-desktop-release` | 1.3G | 桌面发布中转目录（v0.9.13–v0.9.25）；权威产物在 `versions/` |
| `/var/www/flowcube-downloads/quarantine` | 630M | 3–4 月隔离物：0.3.x 旧安装包 550M、`tmp-upload` 79M、0 字节 Playwright 快照、440K 旧 SQL 等 |
| `journalctl --vacuum-size=200M` | 672M | 标准日志收紧（保留最近 200M） |

执行前的两道保护：

1. **先归档再删除**：把 `quarantine/db-backups/flowcube_backup.sql`（443K，2026-03-28）与
   `quarantine/manifest-20260425-230532.tsv`（64K）取回本机受限目录
   `~/.config/flowcube/cleanup-backups/2026-09-19-quarantine/`，并留存删除前清单 `inventory.txt`。
2. **先校验再删除**：`versions/v0.9.25/FlowCube-Setup-0.9.25.exe` 的 sha256 必须等于 `latest.json` 里的值
   （实测两侧都是 `3f39d656…cab85`）才执行 `rm`——避免误删桌面更新的唯一权威副本。

结果：根分区 **6.0G → 8.6G（88% → 82%）**；`current/`、`latest.json`、`versions/`（v0.9.20–v0.9.25）完好；
**未触碰任何 docker 镜像/容器/卷**（运行中与回退镜像原样保留）。

## 根因修复：中转目录不再永久累积

那 1.3G 来自 `.github/workflows/build-desktop.yml` 的「Publish EXE to canonical download directory」：
产物先 scp 到 `/tmp/flowcube-desktop-release/${tag}`（`release-desktop.js` 只读挂载它完成发布），
**发布完成后从不删除**，于是一版留 108M。现改为在创建目录**之前**注册 `EXIT` trap：

```bash
cleanup_remote_tmp() {
  ssh -p "$ssh_port" ... "rm -rf '$remote_tmp'" >/dev/null 2>&1 \
    || echo "::warning::远端中转目录清理失败，请手工检查 $remote_tmp"
}
trap cleanup_remote_tmp EXIT
```

成功、scp 失败、发布失败三条路径都会清理；清理自身失败只告警，不会反过来把已完成的权威发布判成失败。
`tests/deployment-resources.test.js` 新增第 20 项守住它（**反向验证三例全部成立**：去掉 trap、cleanup 不真的
`rm`、把 trap 挪到 `mkdir` 之后，都必须失败）。

**同类风险提示**：`/tmp` 与 `/opt/flowcube` 同处根分区，而上传前预检要 6144MB 余量——任何写在 `/tmp` 却
不清理的服务器侧流程，最终都会以「部署莫名被拒」的形式暴露（本次只差 24MB）。新增此类中转目录时一律注册
退出清理，或改写到 `versions/` 这类有归属的目录。

## 事故：同一次清理引发了约 6 分钟的生产中断（2026-09-19，本地 UTC+8）

**必须先说结论：这次中断最可能是我那次批量删除触发的，不是误删数据。** 时间线（服务器本地时间）：

| 时间 | 事件 |
|---|---|
| 20:0x | 我执行清理：`rm -rf` 1.3G + 630M、`journalctl --vacuum-size=200M`；命令正常返回，`df` 复核 8.6G |
| 20:06 起 | 系统进入**极端缓慢**：HTTPS 超时（`http_code=000`）、SSH 卡在 banner exchange；journal 出现多条来自我出口 IP 的 `sshd: ssh_dispatch_run_fatal … Broken pipe [preauth]` |
| 20:10:43–20:11:22 | 有一次 SSH 会话真的建立（耗时约 39 秒），说明系统仍在响应，只是延迟达分钟级 |
| 20:11:15 | `crond`：`Job execution of per-minute job scheduled for 20:10 delayed into subsequent minute 20:11. Skipping job run.`——**cron 被延迟到下一分钟并跳过**，直接证明是 IO/调度级阻塞而非进程死亡 |
| 20:12:40 | MySQL 日志：`Received SHUTDOWN from user <via user signal>`（用户在控制台重启） |
| 20:12:57 | `dockerd: Daemon shutdown complete`，容器以 `exitStatus 137` 停止（重启时的正常强杀） |
| 20:13 | 系统引导；容器自动启动；20:14:43 `/api/health` → 200，`/api/ready` → 200 |

**证据与判断**：

- `ping` 全程正常（16–19ms、0% 丢包）而所有 TCP 服务无响应 → 内核网络栈在线，**用户态进程被阻塞**。
- journal **没有断流**（20:00–20:12 共 117 条），但出现 cron 延迟跳过 → 不是完全 hang，而是长时间 IO 阻塞。
- 无 OOM、无 `I/O error`、无 hung task、无 soft lockup（`dmesg` 已随重启清空，journal 无相关记录）。
- 恢复后 `iostat -x`：`w_await 0.27ms`、`%util 0.60%`、`aqu-sz 0.01`；`vmstat` 的 `wa` 为 0–1% → 云盘当下完全空闲。
- 该机在 2026-09-05 就有**官方确认的「云盘读写受限」**历史（见 AGENTS §10）。

综合：在这块已知受限的云盘上，一次性 `unlink` 约 1.9G 文件（外加 journal 删除）产生了足以让服务响应退化到分钟级的
IO 阻塞；不能排除同期 MySQL 写入叠加。**不是误删**——三条 `rm` 的路径都是确定字面量（无通配符误删系统目录的可能），
重启后 `versions/`、`current/`、`latest.json`、22 份备份、docker 数据与容器均完好，MySQL 为**有序关闭且无 crash recovery**。

**今后规范（已写入 AGENTS §0.1）**：

1. 生产机上做批量删除前，先看 `iostat -x 1 2`（`%util`、`await`、`aqu-sz`）与 `vmstat`（`wa`）确认云盘余量。
2. 分批删除（每批 ≤200MB、批间隔数秒），并用 `ionice -c3 nice -n19` 降低对在线服务的影响。
3. 不在 MySQL 写入高峰或部署进行中做；尽量安排在维护窗口、用户在场时执行。
4. 需要控制台级恢复（强制重启）时，明确请用户操作——本机只有 SSH 私钥，没有阿里云控制台凭据，且平台强制的本人验证不绕过。

## 恢复与上线验证（2026-09-19 20:13 用户重启后）

- 系统 20:13 引导，三个容器**自动启动**（`flowcube-frontend` / `flowcube-backend` Up；`flowcube-mysql` Up **healthy**），无需人工拉起。
- MySQL 日志为**有序关闭**（`Received SHUTDOWN from user <via user signal>`）→ 无 crash recovery，数据完整；`/api/health` 与 `/api/ready` 均 200，关键表只读抽样正常。后端那条 `ECONNREFUSED 10.255.2.2:3306` 只出现在重启瞬间。
- 清理释放的空间保留：重启后 `df` 8.6G，部署后 8.3G（镜像替换消耗约 0.3G）。
- **`e6f26d1` 部署成功**（`gh run rerun 35441750214 --failed`）：12:28 `==> 发布门禁通过`、`==> 部署完成，健康检查与发布门禁已通过`；服务器 `/opt/flowcube` HEAD = `e6f26d1c`，前后端镜像 `org.opencontainers.image.revision` 同为 `e6f26d1cdc8a…`。

**上线验证（公网静态资源链路，不依赖登录态）**：

```
线上 index.html → assets/index-PQBjLKLq.js（入口）
                → 引用 assets/index-C-6mSpfO.js
                → 引用 assets/index-BWAfSxii.js（财务看板实现）
公网 GET /assets/index-BWAfSxii.js → 200，含「费用构成」（页面独有实现文案）与「个账户」（本次新增）
```

**定位教训**：`资金看板`、`账户余额分布` 这类文案在入口 chunk 与页面 chunk 里都会出现（路由标题 / ChartWidgets 组件），**不能用来判断「页面的实现是否更新」**；要用页面独有的实现文案（如 `费用构成（已付款）`）定位，并沿 `index.html → 入口 → import 链` 逐跳确认可达，最后用公网 `curl` 复验（容器内 `docker exec` 的嵌套 `sh -c` + grep 容易因转义产生误导性结果）。

**附带发现（待办，未处理）**：前端容器 `/usr/share/nginx/html/assets` 有 250 个文件、3.7M，其中 `index-*.js` 多达 **59 个**，只有少数被当前入口引用，其余是历次构建留下的孤儿文件——Docker 层叠加 + `COPY dist` 不清理目标目录所致。当前**无害**（孤儿不被引用、hash 唯一不会误加载），但每个版本都会再叠加一份，是前端镜像与服务器磁盘的持续膨胀源。建议：前端 Dockerfile 在拷贝产物前清空目标目录（或改用清空 + 多阶段），并在部署后核对 `index.html` 引用的 chunk 确实存在。

## 第二轮清理：docker 镜像标签（2026-09-19，用户授权「继续清理服务器」）

**发现**：flowcube 相关镜像标签共 **210 个**，其中：

| 类别 | 数量 | 说明 |
|---|---|---|
| `rollback-<epoch>` 标签 | 128（前端 59 + 后端 69） | 仓库里**没有任何代码创建或使用**它——`server-update.sh` 的回退用的是运行时捕获的 `PREVIOUS_*_IMAGE`（部署前运行镜像 ID），不是该标签 |
| 40 位 SHA 标签 | 80 | 历次部署 `flowcube-{frontend,backend}:<sha>` |
| 悬空镜像（`<none>`） | 53 | 无标签的层残留 |

后端的逻辑大小 392MB/个、前端 66MB/个（含共享层，实际占用由独占层决定）。

**处置**（保留集合 = `latest` + 当前 `e6f26d1c` + 上一版 `ea13046` + 各一个最新 `rollback-1788518776`）：

- 动手前按红线确认 IO：`%util 0.80%`、`w_await 0.24ms`、`aqu-sz 0.01`、`wa=0`；
- 分三批、每 20 个间隔 3 秒、`ionice -c3 nice -n19 docker rmi`（不跑任何 `prune`）：
  - 第 1 批 70 个 → **磁盘 8.3G → 17G 可用（83% → 65%）**，释放约 **8.7G**；
  - 第 2 批 70 个 → 空间无变化（这些标签指向的层仍被其它标签引用，属正常）；
  - 第 3 批 62 个标签 + 53 个悬空 → 再释放约 1G，**悬空镜像归零**。
- 结果：**17G 可用（64%）**，仅剩 8 个镜像标签；`e6f26d1c` 运行中的前后端容器未受影响（部署门禁与健康检查随后仍为 200）。

**有意未做**：

- **docker 卷**未动：`docker volume ls` 与 `docker system df` 在这台慢盘机上会挂起（连续两次 60 秒零输出；而 `image ls` / `rmi` / `ps` 正常），且卷可能承载 MySQL 数据——**风险大于收益**，且当时磁盘已回到 64%。
- `/var/log`（journal 105M + `messages` ~15M）、`/opt/flowcube/backups`（5.2M）、`versions/`（644M 权威副本）、`current/`（108M）均保留。
- 前端镜像内的 dist 孤儿文件需在 Dockerfile 层修，属代码改进而非服务器清理。

**操作教训（本次自己踩的第二个坑）**：为盘点做了 30+ 次**独立 SSH 短连接**，其中多次被本地 `timeout` 强杀，随后出现「SSH 无输出/超时、而 HTTPS 一直 200」的现象——符合 sshd `MaxStartups` 对未正常关闭连接的限流特征。**生产机操作应复用连接**（`-o ControlMaster=auto -o ControlPath=... -o ControlPersist=300`），并把多条只读查询合并进一次会话，而不是反复新建 + 强杀。
