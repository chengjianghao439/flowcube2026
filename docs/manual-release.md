# GitHub 手动离线应用发版

本变更仅交付代码。没有配置 GitHub 环境/Secrets、安装接收器、创建账号或钥匙，没有连接服务器或进行正式 QA。运维完成本节配置与非生产演练、代码验收并由有权人员另行合入之后，才能使用新流程。本 PR 不合并、不发版。

## 谁决定、如何绑定批准

顺序固定：**运维备份并问老大 → 老大明确回“发”且手动触发 → 发布 → 运维检查 → QA 真浏览器逐项人工验收**。push/合并只入库；网页和 PDA 工作流仅 `workflow_dispatch`，没有 push、workflow_run、workflow_call 或自动串联发布。两个工作流分别手动触发；PDA 必须对应服务器收据中已成功执行的同一网页 SHA/版本。

不收“已批准”布尔输入。运维在本仓库一个审批 issue 中先发表以下两行（替换尖括号内容，不能带服务器地址、口令或备份正文）：

```text
备份就绪 <完整40位SHA>
收据 SHA256 <备份收据文件的64位SHA256>
```

老大核实实际备份及可恢复性后，在**同一个 issue** 另发一条完整评论：

```text
发 <同一个完整40位SHA>
```

然后由老大本人在 GitHub Actions 的 main 上运行 `Deploy Browser App`，填写 `checkout_ref`、`backup_comment_id`、`approval_comment_id`。评论 ID 为评论链接末尾 `issuecomment-` 后的数字。身份按 GitHub 数字 ID 核验，不认显示名；服务端还用运维配置的老大/运维 ID 白名单复核。评论正文的有效时间取最后编辑时间；触发后编辑拒绝。评论必须先备份、后批准、后触发，备份评论不超过24小时，不接受机器人代发；工作流中途再次查询。只允许 attempt 1；失败后不能点 Re-run，需先查清结果，再建立新的批准与手动运行。重复 SHA、版本及 PDA versionCode 都会被服务器阻断，包括失败或未知的旧尝试。

机器能验证的是评论作者、正文 SHA、时间顺序、GitHub 执行身份和 run/attempt。**评论不能证明实际备份、恢复演练或老大在其他沟通渠道的意愿**，这些仍是运维人工门禁。记录不得伪造；没有先完成备份并得到老大明确“发”，就不能创建批准评论或触发。这里提出 GitHub 评论作为可核验的授权载体，不能把其他人的评论、客户端输入或自动 smoke 当成老大授权。

## 构建与身份链

1. 从正在执行的 `github.workflow_sha` 检出可信工具，解析明确的完整 SHA。目标必须在本次读取的 origin/main 历史中，拒绝短号、分支、标签、未合入提交和非 main 工作流。已通过的旧 SHA 不能替另一 SHA 放行。
2. 用 GitHub API 查询该 SHA 的 `test.yml` 和 `security-scan.yml` 最新可信 main 运行（安全扫描包含后来的schedule，不能借旧push绿灯覆盖新失败）；失败/取消/跳过/未跑均不放行。查询实际 job，并确认 backend、frontend、desktop、scripts/browser-smoke 四项 npm audit 的强制检查步骤真实成功；不改 audit 阈值或源码。发布前在 fresh runner 重查。
3. 无部署秘密的 GitHub 标准 runner 构建 Linux amd64 镜像离线归档，或先原生测试再构建 unsigned APK。APK 在另一个 fresh 发布阶段 runner 签名，沿用已有 Android 签名身份，构建阶段无签名密钥。
4. 归档包含 SHA、版本、完整四份 lock 摘要、检查收据、审批评论身份和逐文件大小/SHA256；网页另含镜像 ID、SBOM、provenance 和实际 smoke 所需的 scripts、PDA 标题源码及路由注册表。服务器从包中读取 smoke 源码，不更新 Git。Compose、数据库锁文件、生产配置和秘密不进入包。
5. fresh 发布 runner 下载本次精确 artifact ID，重新核对目标/run/锁文件/源码归档/审批。在唯一 SSH 步骤才注入新专用发版钥匙。OIDC 仅发布 job 可申请；GitHub 签发的 token audience 包含**整个包**的 SHA256。服务器离线验 RS256 签名，并核 issuer、audience、repo/owner 数字 ID、subject、环境、main、workflow_dispatch、GitHub hosted runner、老大 ID、attempt 1 和**运维批准的完整 workflow_sha**。包的目标 SHA 与签发工作流 SHA 是两个不同身份，均记录，历史目标可用当前受审工具构建。
6. GitHub runner 只运行一次 `ssh ... receive-v1`，以 stdin 传身份头及整包。无 SCP/任意远程 shell、服务器 HTTPS 下载、Mac 中转、镜像仓库或收费服务。主机公钥由独立渠道核对，StrictHostKeyChecking=yes；拒绝 ssh-keyscan 盲信。上传/执行失败不换路、不自动重试；先核服务器收据确定结果。

OIDC 官方字段及自定义 audience 依据 [GitHub OIDC 参考](https://docs.github.com/en/actions/reference/security/oidc)。GitHub 的短期 token 在接收头到达时验有效期，允许已认证的有界上传在 token 到期后完成；不会在传完后放行另一份包。GitHub 公共签名钥匙可能轮换，未知 kid 必须停，由运维在独立维护流程刷新可信公钥，服务器不联网学习信任。OIDC token/SSH 私钥不写入包、收据或日志。

## 服务器配置：仅供运维另行审批执行

本节全部是未来步骤，不是本次执行记录。禁止直接复制旧 Mac key。先列清单、审批未来写入，再由运维：

1. 建专用非 root 登录账号，禁止密码登录。该账号不属于 docker 组，不能写安装代码、策略、状态或应用目录。新 SSH key 由运维按本组织流程保管，私钥只配置到 `manual-release` 环境的 `FLOWCUBE_RELEASE_SSH_KEY`；不在聊天、仓库或工单正文粘贴。
2. 将本次**经过审核的完整提交**中的 `scripts/` 所需可信工具安装到 `/usr/local/lib/flowcube-release/scripts/`，root 所有、他人不可写。接收器固定读取 `/etc/flowcube-release/policy.json`；所有依赖只需事先安装的 Python3、OpenSSL、Node22、OpenSSH、GNU timeout/flock、Docker Compose。生产发版时不安装任何依赖。
3. authorized_keys 对新 key 设置 `restrict,command="/usr/local/lib/flowcube-release/scripts/manual-release/ssh-receive.sh"`；同时禁 PTY、端口/agent/X11 转发、用户 rc 与交互会话。账号 shell 必须能执行 sshd 的固定命令，但不能因此开放普通会话。sudoers 仅允许该账号以 root 执行**固定 receiver.py 且无参数**，不授予 bash/python/docker/scp 任意命令。例如使用 sudoers 的 `""` 参数限制，配合 `visudo -cf` 验证。入口先严格比较 SSH_ORIGINAL_COMMAND 等于 `receive-v1`，再 sudo 固定接收器；接收器不收命令行参数，不从客户端接收路径或可执行命令。
4. 运维核对服务器指纹并配置 GitHub variables：`FLOWCUBE_SERVER_HOST`、`FLOWCUBE_SERVER_SSH_PORT`、`FLOWCUBE_RELEASE_USER`、`FLOWCUBE_SSH_KNOWN_HOSTS`、`VITE_ERP_PRODUCTION_ORIGIN`。本次不填写值。先通过独立代码审查在 `scripts/manual-release/approvers.json` 填入老大/运维的数字ID（默认空名单拒绝所有发版），不能依赖任意可填写的运行参数或仅可变仓库变量；该文件随受审workflow SHA固定。GitHub `manual-release` 环境必须由运维预先建立、只允许 main，并配置本人所需审核限制；Android signing Secrets 仅供 sign job，新 SSH key 仅供传输步骤。仓库级旧 key 不被新网页/PDA引用。
5. 创建 root-owned、其他人不可写的策略、工具和状态目录；敏感文件0600、私有目录0700。策略中列出实际项目路径、现行 Compose **完整顺序组合**、现有环境文件、实际 MySQL版本/镜像 ID、PDA发布挂载目录、备份目录、预装浏览器镜像、审批身份、受信 workflow SHA、GitHub issuer public keys。路径须为无符号链接的真实绝对路径。Compose 每个文件及数据库版本锁文件的摘要均固定；不要从 GitHub 覆盖它们。服务器当前固定8.0.46的文件必须原样保留，不能用仓库旧 Compose pin 替换。策略中的版本取运维现状，代码没有数据库版本常量。
6. 获取 GitHub 官方 OIDC issuer discovery/JWKS 的公共信任材料，在操作端用 `prepare-oidc-key.py` 转成 PEM，独立复核来源/指纹后安装。`oidcKeys` 只接受已审批 kid→PEM 映射；不在生产发版时下载 JWKS。将批准的网页/PDA workflow_ref 各自映射到经过代码审核的 workflow_sha 白名单。代码变更后的新 workflow SHA 必须另外审查，不应自动批准当前 main。
7. 审核并固定 `preservedFiles`：必须涵盖所有实际 Compose 文件、数据库版本锁文件和初始版本基线文件；也建议涵盖本次可信工具与非秘密策略输入。策略不能由发版账号修改。不要把真实策略、环境文件、备份或生产配置提交到仓库。

策略字段示意（大写值均须运维填入实际批准值，不能原样运行）：

```json
{
  "repository": "OWNER/REPO", "repositoryId": "REPOSITORY_ID", "ownerId": "OWNER_ID",
  "subject": "EXACT_GITHUB_SUBJECT", "environment": "manual-release",
  "actorIds": ["BOSS_NUMERIC_ID"], "operatorIds": ["OPS_NUMERIC_ID"],
  "workflowShas": {
    "OWNER/REPO/.github/workflows/deploy-browser.yml@refs/heads/main": ["APPROVED_40_HEX_WORKFLOW_SHA"],
    "OWNER/REPO/.github/workflows/build-pda-apk.yml@refs/heads/main": ["APPROVED_40_HEX_WORKFLOW_SHA"]
  },
  "oidcKeys": {"APPROVED_GITHUB_KID": "/APPROVED/TRUST/issuer.pem"},
  "stateDir": "/APPROVED/STATE", "spoolDir": "/APPROVED/SPOOL",
  "projectDir": "/APPROVED/PROJECT", "toolsDir": "/usr/local/lib/flowcube-release/scripts",
  "composeProject": "APPROVED_EXISTING_PROJECT",
  "composeFiles": ["/APPROVED/PROJECT/base.yml", "/APPROVED/PROJECT/production.yml", "/APPROVED/PROJECT/existing-db-lock.yml"],
  "envFile": "/APPROVED/PROJECT/private.env", "smokeEnvFile": "/APPROVED/TRUST/smoke.env",
  "mysqlLockFile": "/APPROVED/PROJECT/existing-db-lock.yml",
  "initialBaselineFile": "/APPROVED/TRUST/initial-baseline.json",
  "mysqlVersion": "EXISTING_LOCKED_VERSION", "mysqlImageId": "sha256:EXISTING_IMAGE_ID",
  "playwrightImage": "APPROVED_PREINSTALLED_BROWSER_IMAGE",
  "publicOrigin": "APPROVED_HTTPS_ORIGIN", "pdaDir": "/APPROVED/PROJECT/backend/apk",
  "backupDir": "/APPROVED/BACKUPS", "maxBundleBytes": 2147483648, "reserveBytes": 6442450944,
  "preservedFiles": {"/APPROVED/PROJECT/base.yml": "SHA256", "/APPROVED/PROJECT/production.yml": "SHA256", "/APPROVED/PROJECT/existing-db-lock.yml": "SHA256", "/APPROVED/TRUST/initial-baseline.json": "SHA256"}
}
```

运维另行核实当前实际运行的应用SHA/版本/两镜像ID和当前已发布PDA versionCode，写入并审批 `initialBaselineFile`：字段为 `status:"operator-verified-baseline"`、`sha`、`version`、`pdaVersionCode`、`imageIds:{backend,frontend}`。缺文件、缺身份或摘要不符即拒绝，不能把空状态目录当作“没有已发布版本”。网页版本必须高于当前数值三段版本（歧义/预发布版本拒绝）；PDA code必须高于既有事实。正式切换前还会核基线/当前收据的真实容器ID/revision与健康，不能只相信手填基线。

`subject` 使用该仓库实际 GitHub OIDC subject，不能假定新旧格式一致。先在隔离演练中核验；不打印 token。

## 服务器执行边界

固定接收器先验身份和整包摘要，再验证精确文件集合、大小/逐文件摘要、完整 SHA/run/批准身份；路径穿越、重复条目、链接、设备文件、额外文件均拒绝。脚本归档只解出受限 smoke 输入，**不执行上传的 server-update/release-gate/publish-pda**；执行的是 root 预装版本。Docker离线归档也先核仅含目标两应用 tag、镜像config摘要和写入契约，再 docker load，防止借包改变其他tag。

服务器 global flock 阻止并发；调用执行器前先写入并fsync `recovery-required.json` 在途标记，只有成功收据和当前身份全部持久化后才解除。强杀/OOM/断电遗留标记同样阻断全部版本；可捕获的执行失败将该标记记录为失败，在运维核实恢复并另批解除阻断前，连不同版本也拒绝继续发布。版本/SHA/versionCode 的持久占位在执行前 fsync，任何执行失败仍保留阻断，不自动删状态重发。包和失败收据保留，未知先查，不从 GitHub 重跑猜测结果。服务器不保存 OIDC token。

网页部署保留：归档摘要、真实镜像ID/revision、业务写契约、空间预检、MySQL唯一现有容器的 running/healthy、同一容器 TCP认证SQL及实际版本/镜像ID、停写窗口、新鲜备份与独立收据校验、目标镜像自带迁移、`--no-deps --no-build --pull never` 应用切换、ready/前端检查、完整及受限权限 smoke，以及浏览器CPU/内存/交换/进程和内外超时。临时应用image override只改变两应用image，并追加在批准的现行Compose组合后；原文件字节不变。数据库缺失、不健康、版本/镜像/锁文件不符就失败，不启动或修复。迁移权限不够就失败，不改 `log_bin_trust_function_creators` 或其他参数，不升级引擎、不同步cron。没有自动回滚分支；进入停写后失败保持停写，运维用备份恢复。

接收器中断或超时时会TERM整个发布子进程组，保留最多150秒停写/清理窗口，再KILL残余进程；结束前不释放全局锁。Docker daemon内部请求可能已提交，操作结果仍必须由运维核实，不能把客户端停止等同恢复成功。

自动smoke仍是真实自动化操作，会按脚本访问应用；不能声称只读，也不能代替QA。生产smoke账号和运行时已由运维预装，不运行npm install或docker pull。

## 未来写入审批清单与清理责任

以下是未来安装/发版会写入的路径类别。运维须逐项填写实际路径、容量、属主、内容和授权后才能启用；**本次未创建任何服务器文件，临时文件也没有**。

| 路径/对象 | 内容与用途 | 保留及清理责任 |
|---|---|---|
| 专用账号home/authorized_keys、sudoers | 新key公钥、强制命令、无参数receiver白名单 | 运维长期保管，变更另行审批 |
| 固定tools目录、策略、初始版本基线及issuer公钥目录 | 经过审核的接收器/执行器、公共信任和现状约束 | 运维留完整版本/摘要，更新先审查 |
| stateDir/release锁及application锁 | 部署互斥 | 不按时间自动删除；运维处理异常锁/进程 |
| stateDir/版本、SHA、PDA code收据、browser/pda-current.json及recovery-required.json | 防重放、运行身份、应用成功执行事实 | 长期保留，不自动清空失败记录，不冒充QA通过 |
| stateDir/signature-* | OpenSSL离线验签的临时签名字节 | 本次调用finally清理；异常遗留由运维盘点，绝不保存私钥/token |
| spoolDir/incoming-run-随机目录 | 原整包、已验证payload、smoke源码、应用image override和receipt.json | 成败都保留；QA及取证完成后运维列清单按批准策略清理，程序不prune |
| backupDir/pre-migrate-SHA-随机目录 | 本次停写后的数据库压缩快照和receipt.json | 运维按备份制度保留；不自动删除旧备份，不声称已恢复演练 |
| Docker镜像/层、迁移与两应用容器 | 离线load、迁移、停止/启动应用及容器日志 | 运维盘点并保留恢复所需镜像，清理遵守低IO与独立删除批准 |
| /tmp/flowcube-browser-smoke.*、门禁锁及专属gate容器 | 从已核镜像复制锁定运行时、自动smoke | gate自身finally清理专属临时目录/容器；异常遗留运维核对，不批量删其他任务 |
| pdaDir内.publish-pda.*、不可变APK及published-version.json | 同SHA应用的APK交付与原子发布清单 | 发布器仅清本次临时文件，旧APK和清单历史由运维保留/审批清理 |
| GitHub Actions artifact及runner临时目录 | 整包/SBOM/来源和离线验证证据；临时签名/SSH材料 | artifact保留7天；需长期审计由运维及时另存。runner临时秘密finally删除并随临时runner销毁 |

磁盘清理前先按现有运维制度核IO、逐项说明恢复依赖及精确大小；不把新流程启用等同清理授权。人工备份、安装、更改权限、issuer信任轮换、恢复操作及清理都由运维另行执行。

## 非生产演练与故障处置

运维先在完全隔离、仅合成数据的Linux环境安装相同受限账号/代码和策略，准备独立Compose与预装MySQL/浏览器镜像。核对强制命令拒绝id/bash/scp/转发，核伪造/过期OIDC、错误actor/repo/workflow、SHA与hash不符、篡改和链接/穿越包；用两次并发请求证明只执行一次。再执行完整成功网页流程和同SHA PDA流程，核真实Docker归档、真实备份收据、迁移和smoke。注入停写后/备份/迁移/健康/页面失败，证明无回滚、无引擎/参数/cron变更、失败版本不可重发。任何失败先核收据、镜像与容器状态，不自动重试；恢复只由运维按批准备份方案进行。这里是演练步骤，本次没有执行服务器演练。

新key验证成功后，运维先列旧key的指纹、账号、用途、所在系统及仍在使用的流程（包括独立桌面流程）；把影响清单交老大。**老大单独批准后**才停用指定旧key。禁止自动删key，禁止把新key验证当作旧key删除授权。

老大或运维说停：立即停止发送任何命令，包括补查状态；报告最后命令、准确时间与是否在途。未知结果不盲重试。现有运行的中断/恢复由有权运维处理。

## 验收记录与局限

本次仅代码/离线验证。`npm run test:manual-release` 覆盖真实RSA签名、整包字节校验、文件路径、持久防重复/真实flock、GitHub API边界和人工评论约束。执行器回归使用真实shell及真实备份helper，Docker/HTTP只用合成替身；既有资源/超时测试仍保留。它们不能证明正式SSH可达、实际GitHub环境保护、正式权限、真实Compose/8.0.46锁、网络吞吐、进程强杀后Docker daemon内部操作是否结束、实际迁移、正式smoke或QA。

上线后运维逐项记录：完整target/workflow SHA、两条批准评论ID、触发者ID、run/attempt、整包及镜像ID、备份收据、执行结果、现行锁文件摘要。随后运维检查，再由QA真开浏览器按本次变更清单逐项操作并记录实际页面、账号权限、正常/失败/刷新/会话等结果。API、CI绿灯、headless smoke均不得标为“QA验收通过”；PDA安装/扫码仍需真机。

#95/#96的历史离线数据库维护预检保持独立。本次不更改其白名单、不扩大#94工具职责；#96实际只改前端锁文件与offline_maintenance_preflight.py及其测试，没有改release-gate/server-update。本流程不依赖该白名单；对目标完整lock摘要、GitHub同SHA测试及实际npm audit独立检查。
