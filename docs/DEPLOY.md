# 极序 Flow 生产部署固定配置

这份文档的目标只有一个：以后有人说“发布新版本”，执行链路不再依赖口头记忆。

> 📌 换服务器 / 改服务器地址对桌面端的影响、平稳迁移步骤，见：[换服务器与桌面端自动更新说明](换服务器与桌面端自动更新说明.md)。

## 生产环境固定信息

- 生产浏览器地址：`https://jixuflow.com`
- 生产服务器：`root@47.93.228.251`（内网 `172.24.56.21`）
- 生产项目目录：`/opt/flowcube`
- 桌面下载目录：`/var/www/flowcube-downloads`
- 桌面更新入口：`/latest.json`
- 仓库：`chengjianghao439/flowcube2026`
- 仓库内配置文件：`deploy/production.local.json`（从 `deploy/production.example.json` 复制并填写真实值）

## 对外访问链路（域名 + 正式证书）

生产不直接用容器端口对外。宿主机 Caddy 独占 80+443，前端容器（nginx）回环暴露 8080：

```text
浏览器/桌面端
   │  https://jixuflow.com:443（正式证书，SNI=域名）
   ▼
宿主机 Caddy（/etc/caddy/Caddyfile，systemd 管理）
   │  80：ACME 证书验证 + HTTP→HTTPS 308 跳转
   │  443：匹配域名的可信证书（通常为 Let's Encrypt）
   ▼
前端容器 nginx（回环 127.0.0.1:8080，映射自 docker-compose.yml）
   │  /api/ → 后端 3000；静态资源 + /latest.json /versions/ /current/
   ▼
后端容器 127.0.0.1:3000
```

关键配置与注意事项：

- **Caddy 模板**：`docker/Caddyfile`（含部署说明）。换服务器时按模板填真实域名/公网 IP/内网 IP，写入服务器 `/etc/caddy/Caddyfile` 后 `systemctl reload caddy`。
- **前端容器端口**：必须映射 `127.0.0.1:8080:80`，让出宿主机 80 给 Caddy 做 ACME 验证（见 `docker-compose.yml`）。**不要改回 80**，否则 Caddy 证书自动续期会失败。
- **客户端必须验证服务端证书身份**：桌面端已移除按 IP 放行任意证书的过渡逻辑；旧模板的 IP 自签站点不能作为可信更新源。恢复证书故障应修复域名/证书链，不能禁用证书校验。
- **`.env` 生产项**（服务器 `/opt/flowcube/.env`）：`APP_PUBLIC_URL=https://jixuflow.com`（桌面更新链）、`TRUST_PROXY=1`。部署支持来源列表的新后端后，可设 `CORS_ORIGIN=https://jixuflow.com,https://localhost`（Web 与当前内置 Android PDA）、`CORS_ALLOW_NULL_ORIGIN=1`（Electron file://）、`CORS_REFLECT=0`；旧版 v0.9.2 不支持多来源和字符串 null，不能提前切换配置。来源列表是精确匹配，不允许其他协议、端口或子域；null 来源无法区分不同本地文件，业务鉴权仍不可省略。实际设备 Origin 需在客户端验收时确认。
- **CI 的 erp_origin**：由 `scripts/read-deploy-config.js` 读 `deploy/production.local.json`，发布后健康检查/页面烟雾自动走域名。

## 发布原则

- `main` 是浏览器端和服务器端的唯一发布来源。
- `desktop/package.json` 的 `version` 是桌面安装包 tag 的唯一来源。
- 生产服务器信息放在仓库配置里，GitHub Actions 不再额外保存 `SERVER_HOST` / `SERVER_USER` / `SERVER_DOWNLOADS_PATH` 这类非敏感信息。
- GitHub Actions 只保留敏感项：`SSH_PRIVATE_KEY`。
- 桌面端安装包必须通过 `scripts/release-desktop.js` 发布到 `/var/www/flowcube-downloads`，禁止手工复制到旧目录。

## 以后怎么发布

在仓库根目录执行：

```bash
npm run release:prod
```

这个入口推送 main 并打桌面 tag，分别进入以下发布链：

1. `git push origin main`
   - 触发 `Deploy Browser App`
   - 等待同一 SHA、main 可信事件的 `Tests` 与 `Security Scan` 最新运行成功，失败/取消/超时不得部署
   - GitHub Actions 解析部署配置后 SSH 到服务器，在重置代码前获取部署锁，固定实际 SHA
   - GitHub runner 通过 `scripts/build-deploy-images.sh` 构建 Linux amd64 镜像、写 OCI revision 标签并打包；`server-update.sh` 保存旧运行镜像 ID，验证归档 SHA-256 / 镜像 revision，加载镜像、等 MySQL 健康、一次性容器迁移，再切换应用并执行本地/公网健康与页面门禁。生产不再编译
   - 任何核心步骤失败统一恢复旧应用镜像并验证；DDL 不回滚，迁移须兼容旧代码

2. `npm run release:tag-desktop`
   - 自动读取 `desktop/package.json` 的 `version`
   - 推送对应 `v<version>` tag
   - 触发 `Build Desktop Installer`
   - 发布前再次确认实际检出 SHA 的 Tests/Security 成功；手动 checkout_ref 和版本输入不得借用另一 SHA 的绿灯或只重命名版本
   - GitHub Release 自动生成/更新安装包
   - 已配置 SSH 时，CI 会把安装包交给服务器 `scripts/release-desktop.js`，写入 `/var/www/flowcube-downloads/versions/v<version>/` 并更新 `/latest.json` 与 `/current/`

3. `Build PDA APK`
   - `main` 推送且包含 `frontend/**` 或 `backend/apk/version.json` 变更时自动触发
   - 使用 `frontend/android/app/build.gradle` 的 `versionName/versionCode` 构建签名 APK
   - 等待同 SHA 浏览器部署通过，在同一部署锁内确认服务器 HEAD 匹配
   - `scripts/publish-pda.sh` 先发布含 versionCode/摘要的唯一 APK，再原子替换 `backend/apk/published-version.json`
   - 只修改只读挂载目录的宿主文件，不重置 Git/重建后端；校验 `/api/pda/version` 与 `/api/pda/download`

PDA 自动更新的权威关系：

```text
frontend/android/app/build.gradle     # APK 内置版本号
backend/apk/version.json              # 源码中的目标版本，必须与 APK 内置版本一致
backend/apk/published-version.json    # 实际已发布清单，不提交 Git，API 优先读取
backend/apk/FlowCubePDA-<code>-<sha>.apk # 已发布不可变安装包，不提交 Git
```

发布 PDA 时必须同时提升 `versionCode` 和 `versionName`，并保持目标 `version.json` 一致。新发布器拒绝同号不同内容；相同包重试幂等。首次升级部署链时，在 git reset 前保存旧清单为 published-version.json，避免先宣传新版本再收到 APK。API 保留无发布清单的旧部署回退，并可按旧下载 URL 的 code/摘要继续提供原包。

## 桌面端发布目录结构

```text
/var/www/flowcube-downloads/
  latest.json
  versions/
    v1.0.0/
      FlowCube-Setup-1.0.0.exe
      metadata.json
  current/
    FlowCube-Setup.exe
    version.txt
  quarantine/
```

手工应急发布时，只允许执行：

```bash
node scripts/release-desktop.js x.x.x --artifact=/path/to/FlowCube-Setup-x.x.x.exe
```

`latest.json` 是桌面更新权威入口。主进程从可信 HTTPS 清单获取并绑定 version、URL、sha256，下载及安装前各校验一次；无摘要或证书错误不能自动安装。根组件消费更新事件，订阅晚于检查时仍能显示待处理更新。`backend/downloads` 已废弃，仅保留废弃说明，不再用于发布。

### `/downloads` 兼容别名

- `/downloads/` 只用于旧客户端兼容，允许 GET/HEAD 静态访问旧 manifest 已下发的安装包路径。
- 新客户端、新 manifest、新脚本一律使用 `/latest.json`、`/versions/`、`/current/`。
- 生产 `docker-compose.yml` 默认挂载 `/var/www/flowcube-downloads`，不再 fallback 到 `./backend/downloads`。
- 退场计划：目标 `v0.5.0` 后删除 alias；删除前必须确认连续 30 天无 `/downloads/` 访问，且所有受管客户端已升级到 `>=0.3.72`。

## 一次性初始化

### 1. 生成 deploy key

```bash
bash scripts/setup-deploy-key.sh
```

作用：

- 在本机生成 `~/.ssh/flowcube_deploy_ed25519`
- 写入本机 SSH 别名 `flowcube-prod`
- 输出要加到服务器里的公钥

### 2. 服务器信任这把公钥

把脚本输出的公钥追加到服务器：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s\n' '<这里替换成 setup-deploy-key.sh 输出的公钥>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. GitHub Actions 配置 Secret

只需要一个：

- `SSH_PRIVATE_KEY`

填入内容：

```bash
cat ~/.ssh/flowcube_deploy_ed25519
```

### 4. 本机连通性验证

```bash
ssh flowcube-prod 'cd /opt/flowcube && git rev-parse --short HEAD'
```

## 应急发布

优先手动触发 GitHub Actions 的 workflow_dispatch，仍须通过同 SHA 检查。直接运行服务器脚本时，需显式指定已验证提交，并提供 Node 22、GITHUB_REPOSITORY 和具有 Actions 读取权限的 GITHUB_TOKEN（通过受保护环境注入）：

```bash
EXPECTED_COMMIT=<完整40位SHA> \
DEPLOY_IMAGE_ARCHIVE=/path/to/ci-images.tar.gz \
DEPLOY_IMAGE_SHA256=<该CI归档的SHA256> bash scripts/server-update.sh
```

推荐使用 Actions 的 Deploy Browser App → Run workflow，自动完成 CI 构建与传输。手动入口也必须提供同 SHA 的 CI 镜像归档，不允许降级为生产编译。脚本人工入口会重新查询同 SHA 的 Tests/Security；缺少凭据或检查失败会终止。不要默认设置 SKIP_RELEASE_GATE。仅更新服务器应用，不构建桌面安装包。

## 回滚

正常 Docker 部署的失败回退由 server-update.sh 统一执行。旧镜像 ID 来自实际容器，不能以已被新构建覆盖的 latest 标签代替；门禁低磁盘时保留旧镜像并失败，不运行 image prune。恢复失败会明确要求人工处理；首次部署无旧镜像时只停止本次应用。旧镜像启动前，将 version.json 原子恢复为已发布清单以兼容旧 PDA API（因此失败回退后该文件可与 Git 目标版本不同）。数据库迁移不回滚，也不能仅通过恢复旧镜像撤销数据变更。

服务器应急回滚示例：

```bash
ssh flowcube-prod 'cd /opt/flowcube && git log --oneline -n 5'
ssh flowcube-prod 'cd /opt/flowcube && git reset --hard <旧提交> && docker compose up -d --build backend frontend'
```

注意：

- `git reset --hard` 属于回滚操作，只应在明确确认后执行。
- 正常情况下优先用新提交修复，不用直接硬回滚。


## 发布时的资源与超时边界（2026-09-05）

此前把 npm 安装、Vite 编译和浏览器验收全部放在生产机；现在编译在 GitHub runner 完成。归档上传前至少需要 6144 MB 可用空间，加载前和门禁前至少需要 4096 MB；不足时失败，不删除镜像、缓存或数据卷。镜像归档必须与期望 SHA 对应，摘要和 OCI revision 均核对后才能迁移。

浏览器门禁镜像须预先在维护窗口准备；切换前检查存在，验收使用 `--pull never`，防止发布途中临时下载/解压大型浏览器镜像。浏览器验收仍访问已切换的应用，保留失败回退机制。辅助容器最多 1 CPU、1 GiB 内存、256 进程，memory-swap 与 memory 相同（不允许额外交换），两个验收依次执行；每轮容器内 840 秒、客户端 900 秒，EXIT 清理本次验收容器。Docker 管理请求默认 30 秒；加载 600 秒、迁移 300 秒、MySQL 就绪 150 秒、切换 120 秒。CI 远程部署总时限 2400 秒，另留 600 秒回退清理。超时不等于 Docker daemon 内部操作必然立即结束，必须检查回退结果，不能把客户端退出当作恢复证明。

监控用 STATE_FILE 对应的独占锁，上一轮未结束时不重复启动；Docker 请求 5 秒、TLS 握手 10 秒，证书探针失败/超时进入异常状态。探针按目标查询，不扫描 Docker 占用总量。GNU timeout 和 flock 是生产依赖；Mac 隔离测试使用模拟命令，生产实际资源限制需上线后确认。

实现验证和事故时间线见 `docs/production-environment-check-2026-09-04.md`。本地变更未发布时，线上不会自动获得这些保护。

嵌套超时信号：CI 外层设置 `FLOWCUBE_DEPLOY_TIMEOUT_GROUP=1`，内层命令使用 GNU timeout `--foreground`，使总超时的 TERM 同时到达等待中的客户端并让 Bash 执行清理/回退 trap。独立监控不启用此模式。默认 600 秒回退宽限覆盖两轮健康等待、Docker 管理/清理及通知；扩大 HEALTH_CHECK_ATTEMPTS/DELAY 时须同步计算宽限和 CI job 时限。真实进程回归覆盖外层超时后清理与回退都必须执行，见 `tests/deployment-resources.test.js`。
