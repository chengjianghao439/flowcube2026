# v0.13.0 正式发布结果（2026-10-07）

浏览器、Windows 桌面安装包和 PDA 已正式发布 v0.13.0，PDA versionCode 为 151。应用提交和不可变 tag 均为 `afc73d870f00bdfcce1962b33a3059a81e177dc6` / `v0.13.0`。正式入口 `npm run release:prod` 自然退出 0；随后独立 `npm run release:verify -- --origin https://jixuflow.com` 也自然退出 0，两次均 12/12，包括桌面和 PDA 完整下载 SHA-256。

- [GitHub Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.13.0)
- [浏览器入口](https://jixuflow.com)
- [本版说明](release-notes/0.13.0.md) · [分支整合与五轮失败证据](release-v0.13.0-integration.md)

## 同一应用提交的正式工作流

| 工作流 | Run | 最终结果 |
|---|---|---|
| Tests | [37524197027](https://github.com/chengjianghao439/flowcube2026/actions/runs/37524197027) | 21/21 job 成功，含真实数据库回归与专属实例容量迁移 |
| Security Scan | [37524197101](https://github.com/chengjianghao439/flowcube2026/actions/runs/37524197101) | 6/6 job 成功，含 Gitleaks 与四目录依赖 audit |
| 浏览器部署 | [37524196954](https://github.com/chengjianghao439/flowcube2026/actions/runs/37524196954) | 完整镜像扫描、迁移、实际页面门禁、公网验收成功 |
| PDA | [37524196961](https://github.com/chengjianghao439/flowcube2026/actions/runs/37524196961) | 6/6 job 成功，fresh runner 构建、签名、来源核验和生产发布 |
| 桌面 main 验证 | [37524197198](https://github.com/chengjianghao439/flowcube2026/actions/runs/37524197198) | 2 job 成功；正式 publish 按设计跳过 |
| 桌面 tag 发布 | [37525862406](https://github.com/chengjianghao439/flowcube2026/actions/runs/37525862406) | 3/3 job 成功，正式安装包和更新清单发布 |

所有六个运行的 head SHA 均与应用提交一致。GitHub Release 为正式、非 draft、非 prerelease。后续纯交付记录提交带 `[skip ci]`，不改变本应用 tag 或已经部署的 revision。

## 实际产物及来源

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| Windows EXE | 112533217 | `6cd4e843360b96a1d54f39eaafe7267611f2242158af06bacde99aed72732407` |
| PDA APK | 15166282 | `bf5bfc312a2b2d2852bfeec556d77153967c5ffd536c83620f1ba4f95556d589` |
| CI 两镜像归档 | 205412886 | `103d3c00d3c99fc010001eed954fe5d843e2aa19a99ac5caebdd1b44dc4c1886` |

桌面 GitHub 资产名为 `Jixu-Flow-Setup-0.13.0.exe`，对外更新地址为 `/versions/v0.13.0/FlowCube-Setup-0.13.0.exe`；GitHub digest、本轮 artifact、中转与两次完整对外下载的摘要一致。PDA 签名 artifact `11441482973`、桌面 artifact `11442720008` 均由本轮来源记录核验；不是复用上轮 APK 构建成功来代替本轮发布。

完整镜像 SBOM/provenance 保留 artifact `11442081714`，ZIP SHA-256 `4f74d4241dced6eb4878bdac42ceaa5c36ebf84b7606a621ee736b5aae99315f`。独立核对 5 subjects、8 材料、源码与 lock 字节、两份 CycloneDX、实际 producer checksum/image ID：后端 1564 components（449 带 purl）、前端 1287（71 带 purl）。独立审查没有再次下载大镜像归档；归档实际下载/中转、服务器加载校验由正式入口执行。

生产运行镜像均实际核对 revision 与 ID，非仅服务器 Git checkout：

- backend：`sha256:c45bef45b581457ab8a53800a482a565bee784d55b2f9b8315412ef690149028`
- frontend：`sha256:67587eca8403a98aa93b8afba0cdf78cd38b4ffaca44337dfd253681442b5a41`

正式路径包含本机代理中转，不称独立 hosted runner 链路：镜像下载/上传合计 55.6 秒，PDA 18.6 秒，桌面 34.4 秒；全部 receiver workflow 成功，正式中转退出完成。

## 生产结构与宿主核对

276–281 六项迁移已有实际记录，8 张新表及 9 张既有表目标投影的 149 列、78 条索引列序行、36 外键、22 enforced CHECK 全部与独立合成参考一致。核对覆盖列类型/顺序、索引前缀/类型/可见性/表达式、外键名称与列序/同库关系/规则；不是只认迁移记录存在。

两主档 phone 的已确认旧 VARCHAR(11) 已由新增 281 扩为 30；原 COMMENT、字符集、排序规则、默认值、nullable、EXTRA 和生成表达式逐字段保持。已执行 278 没有改写。`schema-reconcile --strict` 自然退出 0，报告 282 迁移、157 声明表/161 实际表和 7 活跃唯一约束通过；一个历史备份表、三个旧索引的 warning 完整保留，未读备份或业务行、未清理这些对象。

MySQL 容器 ID、镜像 ID、StartedAt、RestartCount 和 healthy 状态与部署前逐字段相同；本轮只切换应用，没有为应用发布拉取/重建数据库。六个宿主运维 helper/脚本 SHA-256 与应用提交一致；五项 cron 各一条，受限 cron PATH 可使用 Node 22.23.2。两处 Caddy 代理的 X-Forwarded-For 均覆盖为真实 remote host，配置备份保留，服务 active。

## 分支、失败记录与验证边界

应用提交包含 v0.12.0 基线以来 675 个实际改动路径。最终文件清单另外收录这份发布结果文档，字节摘要覆盖全部路径（清单自身因自引用明确排除摘要）；[完整清单](acceptance/2026-10-07-release/integration-files.json) 与当前记录树逐路径核对。go-live 471 路径、dingtalk 17 路径与原快照和原工作树全部字节一致；其未提交成果已由整合提交保存，原工作树没有 reset/clean。

发布前冻结核对时，14 条本地分支中 13 条为应用提交祖先；后续 main 与发布工作树只前进纯交付记录提交，应用 tag 保持；历史 archive 的两条非祖先提交经补丁等价、现行规则及更新说明核对，产品有效改动已经覆盖。保留分支与工作树，不宣称所有历史 refs 都已 merge。21 条远端 Dependabot 提案保留；Vite/Zod/Node 类型等 major 仍须按兼容规则单独评审，没有作为本地已完成功能盲合。27 项安全整改已纳入应用，详细范围见 [整改记录](security-scan-remediation-2026-10-06.md)；本轮六项 Security job 成功不等同于原 Codex Security 云端重新扫描结果，未宣称该云端已清零。

| 尝试 | 应用 SHA | 失败及实际边界 |
|---|---|---|
| 1 | `828f2c9` | UTC 会话/旧审计和清理夹具、Gitleaks 报告目录、PDA idsig 来源边界；未切生产应用或打 tag |
| 2 | `6914fc3` | 专属实例 mysqladmin 假就绪、旧深审计明细夹具；完整门禁未过，未发布 |
| 3 | `043c232` | Syft tmpfs 权限；Tests 21/21、Security 6/6 成功，尚未执行 SSH 部署 |
| 4 | `01f6d7b` | 完整 SBOM 通过，MySQL 镜像拉取超时；未开始本版生产迁移，旧应用仍健康 |
| 5 | `4c91ebe` | 已完成 276–280；旧组合页标题检查失败，应用回退健康，数据库未回滚；只读核对发现两列 11 位形状 |
| 6 | `afc73d8` | 全部同 SHA 门禁、六项生产迁移、三端发布及独立 12/12 下载核验成功 |

每次失败均保留来源与原日志，修正后换新 SHA 重新走完整入口，没有只重跑失败 job 或跳过门禁。本轮入口记录 1068 秒（17 分 48 秒）；含前五轮失败的正式发布阶段，从北京时间 2026-10-07 01:56:10 到观察自然完成 04:26:26，约 2 小时 30 分钟。前期分支整合和本地验收不包含在此时间中。

Windows 安装/自动更新弹窗、Android PDA 真机安装与硬件扫码、8.4.3 WebView 键盘/安全区、物理出纸、真实承运商与人员试用仍需现场验收；实际钉钉接收也单列，不以合成编码校验代替。旧会话需重新登录，打印工作站需管理员重新注册随机凭据。采购跟进仍在原明确排除范围内。

## 本机证据索引

正式与独立核验日志：`/tmp/flowcube-release-prod-v0130-sixth.log`、`/tmp/flowcube-release-v0130-verify-final.log`。生产结构/phone/MySQL：`/tmp/flowcube-release-production-schema-sixth-verification.json` 与同前缀完整 strict 日志。镜像独立来源：`/tmp/flowcube-sixth-image-provenance.2k0w837k/independent-verification.json`。宿主核对：`/tmp/flowcube-release-sixth-ops-production.json`。原始工作树/分支范围：`/tmp/flowcube-release-sixth-independent-readonly.json`。临时证据保留供本机复查，不把外部临时路径当仓库或生产产物。
