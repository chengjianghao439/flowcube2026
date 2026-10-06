# 请求入口与发布供应链修复（2026-10-06）

扫描基线为 `14e97aa`，扫描 `df58b533`。本轮在隔离分支 `codex/security-scan-remediation` 实现；提交、生产状态以总报告为准。

## 请求入口：#1、#4、#9

Caddy 模板以真实连接对端覆盖 `X-Forwarded-For`；Nginx 保留既有追加行为，Express 仅信任最多两跳的 loopback/私网代理。公网直接连接的伪造 XFF 无效。HTTP 上下文、安全审计和业务日志均使用经过该信任链验证的 `req.ip`。生产须保留后端与 Nginx 的回环暴露、`TRUST_PROXY=1`；**更新应用不会自动替换宿主 `/etc/caddy/Caddyfile`**，正式上线时须按模板更新并核实实际双代理链（见 `docs/DEPLOY.md`）。本轮未登录或重载生产 Caddy。

API 总限流、登录独立限流和每进程 100 请求并发入场都在解析之前。JSON 上限 2 MiB，urlencoded 64 KiB / 1000 参数，结构上限 50000 节点 / 32 层；解析与结构检查只挂 `/api`，其他路径不能绕过入场预算进行 JSON 解析。登录默认每 IP 15 分钟 20 次；应用总默认每 IP 每分钟 1000 次，可通过既有环境变量调整。结束/断开只释放一次入场名额。

通用业务日志在认证成功后挂载，登录与退出只有验证过的 actor 才挂载。未认证业务写请求与超额写请求不预写 `operation_logs`、不借业务日志连接；已认证写仍保留业务前意图预写、业务后完成与单据事件、预写失败阻止业务执行。专用认证审计保留。此结论**不包含公共 `/api/ready` 探针**，该探针沿用自己的连接池单飞与缓存。

## 发布凭据边界：#3、#5

两端均新增只读 `resolve-release-target`：运行入口只能为 main 的 dispatch/main push，桌面还允许准确 vX.Y.Z push tag；输入只接受 main、完整 40 位 SHA 或准确版本 tag，目标必须是解析时冻结的 `origin/main` 历史。任意分支、未合入 SHA、错误运行分支、选项注入与 tag/SHA 不一致均拒绝。所有 checkout 禁止持久化 GitHub 凭据。

桌面构建作业仅有只读 token，不持有 SSH 或发布 token；发布另起 runner，从冻结 main SHA 取可信脚本，经本 run 的精确 artifact ID 下载，核目标 SHA、run ID、安装包及说明文件 SHA256 后，才进入凭据步骤。等待检查仍绑定构建目标 SHA。历史补打包显式把目标 SHA 传给 `git-sync-check.sh`，并核 `.git-build-sha` 等于实际 HEAD。

PDA 构建只产未签名 APK；签名另起 runner，以固定 Android build-tools 35.0.0 的 zipalign/apksigner 处理已核来源的 APK，签名密钥不进入 npm 或 Gradle。签名作业结束清理 keystore；签名产物另有 manifest 与不可变 artifact ID。发布从冻结可信 main 取工具，核签名 artifact 的目标 SHA/run/完整字节，使用同目标 `version.json`，等待浏览器部署后才持有服务器部署组。现有 SSH 主机键、版本/SHA、磁盘、上传、锁与远端清理闸门保留。

EXE/APK artifact 包含小型 manifest 及必要 metadata；本机中转与服务器 HTTPS 接收器必须按精确白名单和 manifest hash 提取二进制，不能将任意 ZIP 成员放行。镜像传输包继续只允许单文件。两端接收器严格拒绝未知/重复/路径/链接/加密成员与重复 JSON 键；metadata 含 manifest 单项及合计最多 1 MiB，仅读入内存。relay 仍只挑 push run，绑定实际 head_sha/run ID；receiver CLI 通过 fresh CI 已核实来源的预期原始字节摘要绑定目标，不将历史 dispatch 的 head_sha 当 checkout 目标。旧单文件产物保留原摘要门，失败保留既有目标并清本任务新文件。Python relay 24/24、Node 传输及发布专项 28/28、包装入口 1/1（复用内部 24 项，不重复计数）均自然退出 0。真实服务器传输待正式交付验证。

main 的平台保护及 GitHub Environment/权限配置需要在远端核实；来源清单为本 run 的哈希记录，**不宣称 GitHub/OIDC 签名 attestation**。本轮未派发发布工作流。

## 下载和镜像：#19、#21、#25、#26

Gitleaks license 通过独立 output 判定，两个实现互斥。Docker fallback 固定摘要，仓库只读挂载、输出独立目录、无 GitHub token、无网络、cap-drop 和 no-new-privileges；检查发现仍失败，SARIF 上传失败不改扫描结论。

NSIS 固定 3.0.4.1 的 SHA256 为 `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa`，下载后先核对再解包。摘要与锁定 `app-builder-lib 26.15.3` 的官方 toolset 配置独立一致。该下载本轮本机超时，没有声称实际归档下载成功；真实 helper 对正常受控字节/篡改字节的行为已验证。

Gradle 8.11.1-all 固定官方 `distributionSha256Sum=89d4e70e4e84e2d2dfbb63e4daa53e21b25017cc70c37e4eea31ee51fb15098a`。官方校验文件当场读取；真实 wrapper 在自有临时缓存中对受控错误 ZIP 返回校验失败，未执行分发内容。完整 Android release 构建及签名仍待 CI。

| 外部镜像 | 官方 registry manifest SHA256 |
|---|---|
| node:22-alpine | 0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 |
| nginx:alpine | df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2 |
| mysql:8.0 | 7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b |
| grafana/loki:3.2.1 | 09a53b4a4ff81ffcd8f13886df19d33fac7a8d3aaf952e3c7e66cbade5b2fc31 |
| grafana/grafana:11.2.0 | 408afb9726de5122b00a2576763a8a57a3c86d5b0eff5305bc994ceb3eb96c3f |
| ghcr.io/gitleaks/gitleaks | c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f |
| anchore/syft:v1.54.0 | 0356562f495d432056237fbea5cbc2d4839c9c75cd500784a66de2e7cc95ca7c |

摘要来自官方 registry 原始 manifest/index 字节，SHA256 与响应 `Docker-Content-Digest` 一致。换摘要必须在独立变更中记录来源、版本/平台、审阅及构建验收，不可自动恢复为浮动 tag。应用镜像由 runner 同 SHA 构建、校 revision 后传输；Compose 中其本地别名继续沿用既有部署契约。

runner 在发布前通过固定 Syft 扫描两份实际导出的镜像：源只读、无 Docker socket/网络、输出独立目录。缺失、损坏或空 SBOM 即失败。CycloneDX SBOM 与 SLSA 格式来源记录绑定源码 SHA、run、归档/镜像/SBOM 摘要、Dockerfile、lockfile 和基础镜像摘要，artifact 保留 30 天；现有 20 分钟构建步骤预算包含生成，超时即失败。

本机 Colima Docker DNS 返回 connection refused，因此本轮没有完成 Syft 镜像拉取或真实容器扫描，也未修改其他任务的 Docker 网络。CLI 使用隔离 fake Docker 做成功、扫描失败、损坏 SBOM、收尾反向验证；真实生成仍待 GitHub runner，不能把这些契约测试描述成已产生生产 SBOM。

官方依据：[GitHub Actions 安全用法](https://docs.github.com/en/actions/reference/security/secure-use)、[Syft 官方说明](https://github.com/anchore/syft/blob/main/README.md)、[Gradle 校验文件](https://services.gradle.org/distributions/gradle-8.11.1-all.zip.sha256)。
