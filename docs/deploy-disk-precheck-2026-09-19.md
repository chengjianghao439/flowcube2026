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
