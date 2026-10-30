# 极序 Flow 生产部署固定配置

> **现行发布约束（2026-10-30，用户明确要求）**：发布失败即停止并保留本次 SHA、阶段、迁移状态、备份路径和原镜像身份供人工核查；不自动 tag 旧镜像、不重建或恢复旧容器、不改写 PDA 清单。前置检查失败保持原应用；停写请求开始后失败（含信号、备份、半迁移、应用或页面门禁失败）停止 backend/frontend 并保持停写，核查后向前修复。数据库 DDL 和业务数据不自动回滚。迁移前以固定完整 SHA 的候选镜像、Compose 实际迁移账户运行独立只读 helper（覆盖配置锁定 image/read_only，使用 pull_policy: never 并以 !reset 清除继承 build，兼容 Compose 2.27.0 run 无 --pull 参数，以 node 用户和 node entrypoint 执行，不启动应用或迁移器）。读取候选 SQL 和 db_migrations 求待执行集合；没有待执行触发器/函数时，不因 trust=0 拒绝。有相关待执行 SQL（含动态字符串及 ALTER FUNCTION）时，先核实际迁移数据库的 TRIGGER、CREATE ROUTINE 或 ALTER ROUTINE 权限，再核已有 log_bin=0、trust=1 或迁移账户全局 SUPER/ALL 之一；未知或查询失败在应用标签改变、停写和迁移之前拒绝。显式 DEFINER 身份未证明时拒绝；binlog 开启且 trust 关闭时，无法可靠证明函数声明的 CREATE/ALTER FUNCTION 保守拒绝。发布脚本不执行任何 SET GLOBAL，不修改或恢复数据库全局参数和权限；原 schema 权限与迁移器完整检查继续生效。同 SHA 的镜像、实例归属、全新备份 create/verify、迁移及安全/健康门禁保持。下文历史回退记录不构成当前自动恢复授权。

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

### 小满的部署接入（2026-10-26，代码接入不代表已上线）

小满正式请求为现有 `/api/assistant/*`。前端与 Electron 安装包跟随当前 ERP API 地址，经现有 Nginx `/api/` 代理进入原后端，不开放8932或新增生产服务。`Dockerfile.backend` 复制 `agent/package.json` 与 `agent/src/` 至 `/opt/flowcube-agent`；`scripts/build-deploy-images.sh` 仍只构建、打同 SHA revision 并归档原 backend/frontend 两个镜像，`server-update.sh` 原健康/权限门禁与失败停止与证据保留遵循本页现行约束。业务规则仍走原 Flow API，任务运行时不会在迁移或发布辅助命令中启动第二监听进程。

Compose 只向 backend 注入以下模型变量，不能传给 Vite 构建或写进交付物：

| 变量 | 要求 |
|---|---|
| `AGENT_MODEL_BASE_URL` | 启用自然语言模型时必须，与提供方兼容接口地址一致 |
| `AGENT_MODEL_NAME` | 启用模型时必须，使用账户实际可用名称 |
| `AGENT_MODEL_API_KEY` | 启用模型时必须，沿受保护的生产进程环境注入，禁止回显 |
| `AGENT_DATA_DIR` | Compose 固定为 `/var/lib/flowcube/assistant`，挂载 `assistant_data` 命名卷 |

未配置模型时只提供规则可识别业务与稳定概念解释，不可宣称已启用模型。后端入口仅正常服务启动准备私有任务目录；显式迁移/发布命令不创建目录或加载运行时。发布失败保留任务卷，不使用 `down -v`。历史文件若损坏返回明确503并保持原文件，须核对修复，不自动清空。生产配置和启动由统一发布任务在同 SHA 门禁通过后执行；本地隔离构建页面不能代替生产模型配置、Windows 安装包或上线验收。

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

这个入口推送 main，等待同 SHA 的检查、浏览器部署、PDA 发布和桌面验证构建全部成功，再打桌面 tag 并等待实际发布；最后执行线上版本与安装包 SHA256 核对。正常成功目标 15 分钟，异常网络与回退保留独立预算，详见 `docs/release-flow-speed-2026-09-22.md`。以下各链的关系为：

1. `git push origin main`
   - 触发 `Deploy Browser App`
   - 等待同一 SHA、main 可信事件的 `Tests` 与 `Security Scan` 最新运行成功，失败/取消/超时不得部署
   - GitHub Actions 解析部署配置后 SSH 到服务器，在重置代码前获取部署锁，固定实际 SHA
   - GitHub runner 通过 `scripts/build-deploy-images.sh` 构建 Linux amd64 镜像、写 OCI revision 标签并打包；优先让服务器 HTTPS 拉取临时 artifact，失败明确回退并行 SCP；`server-update.sh` 保存旧运行镜像 ID，验证归档 SHA-256 / 镜像 revision，加载镜像、等 MySQL 健康、一次性容器迁移，再切换应用并执行本地/公网健康与页面门禁。生产不再编译
   - 发布失败即停止并保留本次 SHA、阶段、迁移状态、备份路径和原镜像身份供人工核查；不自动 tag 旧镜像、不重建或恢复旧容器、不改写 PDA 清单。前置检查失败保持原应用；停写请求开始后失败（含信号、备份、半迁移、应用或页面门禁失败）停止 backend/frontend 并保持停写，核查后向前修复。数据库 DDL 和业务数据不自动回滚。

2. 同 SHA 浏览器和 PDA 工作流均已成功后，`npm run release:tag-desktop`
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

## 全新空库初始化

只在首次安装且目标 schema 没有任何对象时运行。先创建独立的新 schema，准备本版候选构建和受保护的运行配置，停止应用、scheduler 与 worker。使用 Node 22，并从受保护的进程环境或密钥注入配置；初始化命令不读取 `.env`，不能依赖工作目录中已有的配置文件。

| 必需环境变量 | 要求 |
|---|---|
| `DB_HOST` | 显式指定已核对的新库所在数据库主机 |
| `DB_PORT` | 显式指定数据库 TCP 端口 |
| `DB_USER` | 本次初始化的数据库迁移账号 |
| `DB_PASSWORD` | 必须显式注入该迁移账号的口令；不写进命令、日志或文档 |
| `DB_NAME` | 已创建且没有任何对象的目标 schema 名称 |
| `JWT_SECRET` | 必须从环境注入，至少 32 个字符；初始化器会加载正常后端运行配置 |
| `NODE_ENV` | 正式部署设为 `production`，下列生产条件校验同样适用于新装脚本 |
| `APP_PUBLIC_URL` | `NODE_ENV=production` 时必填且非空；从既有部署配置注入正式公开入口 |
| `TRUST_PROXY` | `NODE_ENV=production` 时必须为 `1`，遵守现有后端反向代理配置要求 |

生产模式下 `DB_PASSWORD` 还必须非空；不通过切换运行模式绕过配置检查。其它正常后端运行配置按部署环境提供，不使用应用运行账号的默认值猜测目标库。迁移账号须能在 `information_schema` 看到目标库全部对象，并具备目标 schema 的 `SELECT`、`INSERT`、`UPDATE`、`DELETE`、`CREATE`、`ALTER`、`DROP`、`INDEX`、`REFERENCES`、`CREATE TEMPORARY TABLES` 和 `TRIGGER` 权限；其中 `TRIGGER` 用于既有往来明细触发器迁移。若服务启用二进制日志且 `log_bin_trust_function_creators=0`，还须由数据库管理员独立核实迁移账户权限；发布脚本不建立权限窗口，参数条件不足时在停写前拒绝；不要临时扩大应用运行账号权限来跳过检查。

配置完成后在仓库根执行：

```bash
node backend/scripts/bootstrap-new-database.js
```

该命令不读取 `.env`，缺少任一显式数据库配置即拒绝。若用本版候选后端镜像并由 compose 注入完整配置，等价入口为：

```bash
docker compose run --rm --no-deps backend node scripts/bootstrap-new-database.js
```

入口先核 `information_schema`，任一表（包括空 `db_migrations`）、视图、例程、触发器或事件均在写入前拒绝。通过后在同一连接执行原001—295；新的独立初始化SQL严格核历史默认12角色的完整元数据/权限及禁用默认管理员、空业务，只接受精确种子，再安装用户认可的13角色before。最后调用普通完整迁移执行严格296及后续迁移，最终必须是认可的13角色after和13条296修订回执。初始化成功后才继续原部署与管理员引导流程。普通 `npm --prefix backend run migrate` 不会调用此初始化器，直接对空库运行仍会在296按严格基线失败；已有库升级必须继续使用普通迁移。

迁移297只订正219把内置产品条码标签的 `elements` 数组写成字符串造成的已知完整种子错误，不改变模板校验或岗位授权。初始化后须用管理员核对打印模板列表可见“默认销售订单模板”，并打开默认销售模板预览；数据库专项同时通过真实列表服务与默认产品标签的光栅/ZPL生成。自定义、未知或截断模板不会被297猜测覆盖，仍需按具体报错核对，实际走纸另验。

首次初始化失败时保留目标库与完整错误输出，保持停写并核对实际迁移阶段。DDL可能已经提交，初始化入口不提供续跑；重跑会因非空schema拒绝。确认首次安装尚无业务后，另建空schema重新执行，原中断库留作诊断；不得删除现有/中断库的表或迁移记录、伪造296回执或覆盖授权来绕过前置。已有业务库在296出现任何漂移时，依原基线逐项核对、取得明确修复范围后处理，此新库命令不能用于修复。首次部署的备份、同SHA门禁与迁移失败停写规则照常适用。

## 应急发布

优先手动触发 GitHub Actions 的 workflow_dispatch，仍须通过同 SHA 检查。直接运行服务器脚本时，需显式指定已验证提交，并提供 Node 22、GITHUB_REPOSITORY 和具有 Actions 读取权限的 GITHUB_TOKEN（通过受保护环境注入）：

```bash
EXPECTED_COMMIT=<完整40位SHA> \
DEPLOY_IMAGE_ARCHIVE=/path/to/ci-images.tar.gz \
DEPLOY_IMAGE_SHA256=<该CI归档的SHA256> bash scripts/server-update.sh
```

推荐使用 Actions 的 Deploy Browser App → Run workflow，自动完成 CI 构建与传输。手动入口也必须提供同 SHA 的 CI 镜像归档，不允许降级为生产编译。脚本人工入口会重新查询同 SHA 的 Tests/Security；缺少凭据或检查失败会终止。不要默认设置 SKIP_RELEASE_GATE。仅更新服务器应用，不构建桌面安装包。

## 发布失败与人工恢复

发布失败即停止并保留本次 SHA、阶段、迁移状态、备份路径和原镜像身份供人工核查；不自动 tag 旧镜像、不重建或恢复旧容器、不改写 PDA 清单。前置检查失败保持原应用；停写请求开始后失败（含信号、备份、半迁移、应用或页面门禁失败）停止 backend/frontend 并保持停写，核查后向前修复。数据库 DDL 和业务数据不自动回滚。迁移前以固定完整 SHA 的候选镜像、Compose 实际迁移账户运行独立只读 helper（覆盖配置锁定 image/read_only，使用 pull_policy: never 并以 !reset 清除继承 build，兼容 Compose 2.27.0 run 无 --pull 参数，以 node 用户和 node entrypoint 执行，不启动应用或迁移器）。读取候选 SQL 和 db_migrations 求待执行集合；没有待执行触发器/函数时，不因 trust=0 拒绝。有相关待执行 SQL（含动态字符串及 ALTER FUNCTION）时，先核实际迁移数据库的 TRIGGER、CREATE ROUTINE 或 ALTER ROUTINE 权限，再核已有 log_bin=0、trust=1 或迁移账户全局 SUPER/ALL 之一；未知或查询失败在应用标签改变、停写和迁移之前拒绝。显式 DEFINER 身份未证明时拒绝；binlog 开启且 trust 关闭时，无法可靠证明函数声明的 CREATE/ALTER FUNCTION 保守拒绝。发布脚本不执行任何 SET GLOBAL，不修改或恢复数据库全局参数和权限；原 schema 权限与迁移器完整检查继续生效。现有备份/归属、镜像 revision、目标写入契约、迁移器、健康及页面门禁保持；不自动 image prune。

应急恢复先核实迁移记录、触发器完整性及目标镜像的数据库契约。优先通过新提交修复并重新运行正式发布流程；不得只恢复旧提交后启动不兼容代码，也不得在生产重新编译。0.13.5的288–292数量/退货/资金证明要求实际旧后端具备 `io.flowcube.quantity-return-cash-contract=1` 及原240契约；0.13.4缺新标签，进入迁移窗口后失败保持停写并向前恢复，重试不凭已有迁移记录自动放行。新增可空字段不构成语义兼容证明，详见 `docs/print-deploy-ops.md`。

## 发布成功后的镜像与磁盘收尾

每次正式发版成功且本地、公网健康及版本验收通过后，必须完成镜像与磁盘盘点，在该版本发布结果中记录保留集合、拟清理清单及处理结论。此项是发布成功后的运维收尾；发布期间和失败恢复阶段仍遵守原门禁，不因空间不足自动清除镜像。

1. **先只读盘点并保存脱敏证据**：核对服务器身份、发布 SHA、当前实际镜像 ID、标签/OCI revision/digest，以及全部运行中和停止容器的镜像引用；记录磁盘使用和可用空间。镜像名义总大小含共享层，必须与实际可释放量、清理后实测空间净增分别记录，不能相互替代；慢盘诊断仍使用有时限、按目标的查询，不做无界全盘统计。
2. **按真实用途保留**：保护当前运行版本、数据库和发布门禁必需镜像，以及经过验证与当前数据结构和业务写入契约兼容的必要恢复版本。保留镜像不等于可安全回退；不能把旧版本、可空 DDL 或迁移记录单独当成恢复写入的兼容证明。没有经验证兼容的恢复版本时，明确记录并按上节向前恢复要求处理。本规则不设固定保留版本数量。
3. **核实恢复来源和相同副本**：恢复证据可以是仍可获取、完整性已验证的同 digest 仓库副本，或能还原完全相同镜像 ID 的既有 CI 归档/可靠备份。仅有 tag、源码可重建、来源报告或过期归档不算恢复证明；缺少 RepoDigests 本身也不等于不可恢复。删除前核对归档实际可获取性、完整性和目标镜像身份，不输出凭据。
4. **只提出明确无引用、无必要用途的旧镜像精确清单**：逐项列出完整镜像 ID、标签/身份、大小、全部容器引用核对结果、恢复证据和删除风险。已确认不能恢复、可能唯一副本或尚不能证明可恢复的对象，必须先取得用户针对此清单的永久删除确认；没有确认就保留并记录待确认。恢复用途或身份不明的对象先核实，不为释放空间扩大清理范围；发版成功本身不构成删除授权。
5. **在已授权范围内低 IO 执行并复核**：执行前再次检查引用、保留用途、部署状态及 IO，沿用 [AGENTS.md](../AGENTS.md) §0.1 和[云盘清理约束](deploy-disk-precheck-2026-09-19.md)的分批上限、低优先级、批间等待要求，健康或 IO 异常时暂停。一次性批量例外不改变后续默认规则。使用精确镜像 ID 正常删除，不用宽泛 prune 或强制删除，不为通过镜像删除而删除容器。镜像清理不包含任何容器、数据卷、数据库、备份、业务文件、日志或远端仓库产物的删除，也不包含服务重启或重新部署。
6. **收尾必须有结论**：记录每项成功、失败、跳过或结果不明，实际空间净增和最终余量，并核对原容器 ID、启动时间、重启次数、挂载，以及本地/公网健康和三端版本。客户端超时不能视为删除成功，须检查实际状态后再决定下一步；没有可安全清理对象或仍待确认也应如实记录；不得借镜像清理擅自缩短备份保留期或改变已约定的镜像保留用途。

## 发布时的资源与超时边界（2026-09-05）

此前把 npm 安装、Vite 编译和浏览器验收全部放在生产机；现在编译在 GitHub runner 完成。归档上传前至少需要 6144 MB 可用空间，加载前和门禁前至少需要 4096 MB；不足时失败，不删除镜像、缓存或数据卷。镜像归档必须与期望 SHA 对应，摘要和 OCI revision 均核对后才能迁移。

浏览器门禁镜像须预先在维护窗口准备；切换前检查存在，验收使用 `--pull never`，防止发布途中临时下载/解压大型浏览器镜像。浏览器验收访问已切换的应用；失败停止应用并保留证据，保持停写。辅助容器最多 1 CPU、1 GiB 内存、256 进程，memory-swap 与 memory 相同（不允许额外交换），两个验收依次执行；每轮容器内 840 秒、客户端 900 秒，EXIT 清理本次验收容器。Docker 管理请求默认 30 秒；加载 600 秒、迁移 300 秒、MySQL 就绪 150 秒、切换 120 秒。CI 远程部署总时限 2400 秒，另留 600 秒停写清理。超时不等于 Docker daemon 内部操作必然立即结束，必须核实应用停写及守护进程实际状态，不能把客户端退出当作停止证明。

监控用 STATE_FILE 对应的独占锁，上一轮未结束时不重复启动；Docker 请求 5 秒、TLS 握手 10 秒，证书探针失败/超时进入异常状态。探针按目标查询，不扫描 Docker 占用总量。GNU timeout 和 flock 是生产依赖；Mac 隔离测试使用模拟命令，生产实际资源限制需上线后确认。

实现验证和事故时间线见 `docs/production-environment-check-2026-09-04.md`。本地变更未发布时，线上不会自动获得这些保护。

嵌套超时信号：CI 外层设置 `FLOWCUBE_DEPLOY_TIMEOUT_GROUP=1`，内层命令使用 GNU timeout `--foreground`，使总超时的 TERM 同时到达等待中的客户端并让 Bash 执行停写清理 trap。独立监控不启用此模式。默认 600 秒失败收尾宽限覆盖停止应用、Docker 管理/清理及通知；扩大 HEALTH_CHECK_ATTEMPTS/DELAY 时须同步计算宽限和 CI job 时限。真实进程回归覆盖外层超时后停写与清理都必须执行，见 `tests/deployment-resources.test.js`。

## Compose 覆盖配置与运行时环境（2026-09-05）

现行 `scripts/server-update.sh` 沿用基础 `docker-compose.yml`，其 MySQL 仅回环 3306、前端仅回环 8080；本次没有改变该部署入口。需要彻底关闭宿主 MySQL 端口时，显式叠加 `docker-compose.prod.yml`。该文件要求 Docker Compose **2.24.4 或更新版本**，使用 `!override` 清除 MySQL 端口并精确替换前端映射。旧版 Compose 不支持时应升级，不能改回 `ports: []`（合并时不会清空）。前端保持 `127.0.0.1:8080:80`，宿主 80/443 留给 Caddy。

Compose 透传 `JWT_ACCESS_EXPIRES_IN`（默认 2h）、`JWT_REFRESH_EXPIRES_IN`（默认 30d）、`JWT_SECRET_PREVIOUS`、`DB_POOL_SIZE`（默认 30）、`DB_ACQUIRE_TIMEOUT_MS`（默认 5000 毫秒，范围 1–60000）和可选 `SENTRY_DSN`；`JWT_EXPIRES_IN` 已失效并从样例删除。改环境后需 `docker compose up -d --force-recreate backend`，单独 restart 不载入新的容器环境。

后端 Sentry 使用已安装的 `@sentry/node`，未配置 DSN 不初始化或发送；配置后只显式上报未知异常与路由模板、方法、requestId，不自动采集 HTTP/SQL、请求体、用户或 breadcrumb。上线前先确认获准使用的 Sentry 项目；第一轮使用内存 transport；第二轮增加本机 HTTP 接收测试，覆盖接受、拒绝及不响应，不向外部服务上传。

依赖安全门禁对三端运行完整 `npm audit --json`（包含 Electron 所在 devDependencies），高危/严重直接和传递依赖均阻断；审计接口失败、非法 JSON、异常退出同样阻断。详见 `docs/prelaunch-runtime-hr-ops-fixes-2026-09-05.md`。

桌面运行时现固定 Electron 44.9.3 / builder 26.15.3；Windows 安装目标仍为 x64。Electron 44 要求 macOS >= 13（旧 macOS 11/12 不再支持）；本机只完成 macOS 目录包与运行时边界验证，Windows 安装/更新和实机打印仍需 Windows 验收。


## 第二轮修复的运行时验收

`/health` 和 `/api/health` 只证明进程存活，PDA 沿用其网络检查协议。新 `/api/ready` 使用应用连接池做只读查询，整个探针最多 2 秒、结果缓存 1 秒，并合并并发探测；数据库不可用或排队超时返回 503，成功返回 200，公开响应不暴露连接信息。部署等待、部署后公网检查、服务监控、日报和 prod Compose 健康检查改用 ready；发布失败不自动启动旧镜像。

连接池对 `query`、`execute` 和 `getConnection` 都限制获取等待；超过 `DB_ACQUIRE_TIMEOUT_MS` 后不再派发该排队 SQL，迟到连接立即归还，队列上限与获取超时分别返回明确 503。该时限不取消已经开始执行的 SQL 或事务；运行中写操作仍依赖原事务、锁等待和幂等规则。

恢复演练默认 `RESTORE_TIMEOUT_SECONDS=900`、`RESTORE_MEMORY=768m`、`RESTORE_CPUS=1`、`RESTORE_PIDS=256`。容器关闭网络，交换内存上限与内存相同；结束、超时和 TERM 都清理本任务容器及匿名卷。外层以 exec 运行 GNU timeout，保证终止调用者 PID 时信号仍到达内部恢复链；不允许零 CPU 配额。Docker 管理请求默认 30 秒，清理最多 5 秒。用合成备份完成过本机真实导入；超时/信号路径由真实进程与模拟 Docker 测试验证，不代表生产恢复演练或异地灾备已经完成。

错误追踪验收命令不读取真实 `.env`，通过获准的安全环境注入 `SENTRY_DSN`：

```bash
node backend/scripts/check-error-tracking.js             # 仅检查是否配置，不发送事件
node backend/scripts/check-error-tracking.js --send-test # 显式发送无业务数据的合成事件
```

探针关闭 SDK client reports，仅发送一条合成事件；底层 HTTP 请求 4 秒未完成则 destroy，flush 等待不能代替 socket 释放。只有接收端 HTTP 2xx 且 flush 完成才返回成功；还须在平台按事件 ID 核对检索、分组和告警。生产错误上报的 client reports 默认行为未改变。缺 DSN 返回 2，未接收或网络失败返回 1；不输出 DSN/密钥。生产接收端与自动异地备份目标仍未配置，需要提供获准服务/安全配置位置并单独完成实际验收，不能根据本机测试标记已接通。

发版秘密扫描覆盖本次候选快照及归档证据。`.gitleaks.toml`精确列出二轮探针四个固定幂等键与一份源码SHA256，均已核实为非认证值；不排除审计目录，不扩大为任意request_key或哈希放行。

## 受限权限门禁凭据（v0.9.11）

正式页面验收同时要求主账号 `SMOKE_USERNAME` / `SMOKE_PASSWORD` 和受限账号 `SMOKE_LIMITED_USERNAME` / `SMOKE_LIMITED_PASSWORD`；配置到 GitHub Secrets，由部署步骤透传到远端 gate 容器，不打入镜像、不写日志或源码。手动运行 release:gate 同样需要显式安全注入四项。缺少配置即失败，不跳过 403 对照。受限账号按用户 2026-09-09 明确授权长期保留，发布后不删除；只能保留 dashboard.view / inbound.order.view。

### SSH 信任材料前置条件（2026-09-23）

浏览器、桌面、PDA 发布及服务器诊断工作流现在要求仓库 Actions 变量 `FLOWCUBE_SSH_KNOWN_HOSTS`，内容是通过既有可信连接或服务器控制台等独立渠道核对的 known_hosts 公钥行（非22端口使用 `[host]:port`）。不自动采信 ssh-keyscan，也不提供 accept-new 回退；未配置时任务在联网部署前失败。v0.11.0 发布准备中，已通过 2026-09-19 保存的本机主机键建立严格校验连接，并与服务器本地 ED25519 公钥指纹一致后设置仓库变量；主机键轮换仍须重新核对。

生产 CORS 必须在启动前迁移到明确来源列表，禁用 `CORS_REFLECT`、移除 `*`，Electron 仅通过 `CORS_ALLOW_NULL_ORIGIN` 单独放行。v0.11.0 发布准备中已只读核查布尔状态，并在服务器保留仅服务器可读的原配置备份后设置 Web `https://jixuflow.com`、当前内置 PDA `https://localhost`、桌面 `null` 来源；未回显其他生产配置。实际 Android 设备来源和联网能力仍需安装验收。

## 2026-10-17 · 迁移前本次备份门禁（A37，源码实现未发布）

本节更新前文的资源预算：`server-update.sh` 外层由 2400 秒增加为 2700 秒，仍保留 600 秒停写清理；新增备份创建与回执复核合用独立 300 秒窗口，内部 create/verify 分别 240/20 秒截止。部署步骤 165 分钟，job 224 分钟；PDA 脚本 225 分钟、等待步骤 230 分钟保持长于浏览器 job。加载 1800 秒和既有迁移/回退预算未缩短。这些是将来发布的配置，不能作为当前生产已生效的证明。

Docker 部署沿用部署锁与停写边界，在核旧后端兼容性后、任何迁移授权或 `MIGRATION_STARTED` 之前，创建 `backups/pre-migrate-<候选完整SHA>-<本次随机值>/`（或现有 `BACKUP_DIR` 内同名目录）。目录必须新建、为空且 0700；压缩转储和回执均为当前用户的 0600 普通文件。每次部署产生独立目录，不从旧文件中选择“最新备份”，也不执行 cron 备份脚本的历史删除。

`pre-migrate-backup.js` 核实际容器/镜像 ID、数据库 UUID/版本/库名、基础表数量及完整有序迁移记录；核 compose 的 backend 目标是同服务 mysql:3306 和同库名。非此标准源配置即拒绝，不猜测外部库；库名首字符不得为减号，转储参数使用 `--` 终止选项解析。转储成功、gzip 可读、完整结束标志与建表数量检查及转储前后来源状态一致后，将候选 SHA、本次目录、迁移前状态摘要和文件 SHA/字节数写入原子回执，并 fsync 文件、本次目录及其两级父目录；目录同步失败同样阻断。独立 verify 再读实际文件与当前状态，成功后才允许迁移。首次空库仅在稳定身份、零基础表、无迁移表及完整空转储同时成立时接受，不能凭没有旧后端或环境开关豁免。未核实来源与回执契约的非 Docker 自动迁移分支现在明确拒绝。

容量预检须有至少 4096 MB 可用空间；这不是对真实转储大小的估算，写入过程中 ENOSPC、权限失败、客户端失败、源变化、中断或总超时仍必须失败。只清本次未完成的 `.part` 及本次流程未完成时的 `receipt.json`，保留历史与已落盘转储取证文件。超时/信号不会证明 Docker daemon 内的操作已终止，失败后应核现场；本次结果不完整时不会用旧备份补成成功。

回执固定 `migrationStarted=false`、`restorationVerified=false`，仅证明执行过当前快照校验，**不代表恢复演练通过**。备份失败阻断后保持停写，不自动恢复旧应用。人工恢复也不撤销 DDL，不自动用备份覆盖现库，也不绕过 288–292 写契约。保留目录/镜像/卷的后续清理仍按既有精确清单、低 IO 与确认规则执行，本批没有新增删除策略。

离线回归执行真实 shell/Node helper，以专属临时文件及假 Docker/SQL/容量/故障输出验证顺序和失败；`node --test tests/audit-deployment.test.js tests/deployment-resources.test.js` 已在既有 CI 入口可达。测试不证明真实 MySQL 快照一致性、生产磁盘性能、实际权限、信号后 daemon 状态或恢复成功；真实备份与恢复需另行授权验收，本轮未连接数据库或执行部署。


### A41/A42 生命周期候选改进（2026-10-17，未发布）

`SIGTERM` / `SIGINT` 及原有致命异常共用退出链：立即进入 draining，停止 HTTP 接入与全部已登记定时循环，再等在途 HTTP、后台工作和启动探测，最后 `pool.end()`。整个流程共用 25 秒截止；正常排空退出 0，超时、HTTP 关闭或关池失败退出非零；重复信号不重复关闭，退出中致命错误升级为失败。调度器、幂等回执即时/周期清理、打印三支并行清理及采购内存快照均统一登记，不再启动下一轮；履约提示仍沿现有可丢弃/有界队列策略，只等待当前工作，不在退出时无限清空。业务 SQL、TTL、权限和数量/金额口径未改。

`/api/ready` 保留现有 2 秒探测、1 秒缓存、并发合并与响应信封；draining 在缓存前及在途探测后检查，返回 503 `NOT_READY`。健康存活接口保持原用途。新业务在 CORS 与健康接口之后、业务限流/正文解析之前返回 503 `SERVER_DRAINING` 并关闭连接；现有 CORS Origin=null 的显式批准开关及权限校验原样保留，不借此次改动开放来源。

普通 Compose 后端候选补齐已有 prod 的 ready 健康检查，使用 127.0.0.1 避免 localhost 地址族差异，`stop_grace_period: 30s` 给应用 25 秒排空留出余量。此处只完成候选配置解析，不实际启用，不代表 Docker/生产信号、反代摘流或真实 MySQL 连接池验收。Docker 的 unhealthy 只标识健康状况，不能据此声称自动重启或业务写入已经完成。

`npm run test:round2-runtime` 加入 `tests/runtime-shutdown.test.js`，沿现有 Tests CI 接线。新增用例在 VM 中执行实际入口/工具，所有 app、SQL 与调度任务依赖均为本地 fake；子进程信号只发给本测试创建的合成进程，不加载真实 dotenv/app/mysql2。覆盖 ready 缓存/在途竞态、停止与排空、不重入、重复信号、启动中退出、任务/HTTP/关池挂起、关池失败及超时非零；三支打印清理不能因一支失败而提前完成。反向破坏与审查证据见本轮独立核验报告。真实数据库、容器停止、生产、PDA、扫码及实际出纸均未验证；发版前仍须按现行完整门禁与正式授权执行。

HTTP 连接关闭还不能证明业务 Promise 已完成。路由装配完成后，`httpDrain` 遍历现有 Express 4 路由、中间件与错误层，保持原 handler 的 this、参数、arity、next 和拒绝语义，只登记返回 Promise 的执行期。退出必须等这些异步工作动态归零，客户端提前断开或已经回包都不能提前放行；等待仍受同一 25 秒期限约束。归零检查留到下一事件循环，使原有 unhandledRejection 策略先决定致命错误，避免关池成功掩盖失败。这是当前 Express 4 返回 Promise 的业务链保障；不把未返回/未登记的独立尽力而为通知或日志视为持久化完成承诺。
