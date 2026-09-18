# v0.9.23 发布结果（2026-09-18）

## 结论

**发布完成**：`npm run release:verify -- --origin https://jixuflow.com` **10/10 项一致**。

| 项 | 结果 |
|---|---|
| 桌面更新清单 | `/latest.json` = 0.9.23；`/versions/v0.9.23/FlowCube-Setup-0.9.23.exe`；sha256 `28c34a0a…` |
| 桌面更新接口 | `/api/app-update/latest` = 0.9.23 |
| 桌面更新说明 | notes 首行 `# v0.9.23` |
| PDA | `/api/pda/version` = 0.9.23 / versionCode **131**，安装包可下载 |
| 生产健康 | `/api/health` = ok |
| GitHub Release | `v0.9.23` 有附件 `Jixu-Flow-Setup-0.9.23.exe`（112,367,186 字节）；`isDraft=true` 是本仓历史一贯状态，权威发布以 `latest.json` + 服务器 `/versions/` 为准 |

发布提交：`a07491e`；tag：`v0.9.23`。

## 本版内容

三端 + PDA 同步到 0.9.23（versionCode 130 → 131）。用户可见的变化：

- **日期口径统一**：全站业务日期改为北京时间基准，修正非 +08 环境下列表筛选窗口、
  账款/对账弹窗、报销默认日期、运费对账年月与财务五个页面的会计期间偏一天的问题
  （收敛 9 处自拼日期实现）。
- **官网「版本更新」补齐 0.9.16–0.9.23**：此前只更新到 0.9.15，近七个版本的变化在官网上看不到。
- **数据访问加固**：表名/列名/列清单/别名统一白名单校验（7 个文件 12 个插值点）。

## 发布过程中遇到的并发互等（已处置，并留下加固）

**现象**：push main 后 `Deploy Browser App` 长时间 `pending`，而 `Build PDA APK` `in_progress`。

**根因**：两者共用 `flowcube-server-deploy` 并发组，而 PDA 的 build job 内含
「等本提交浏览器部署成功」（`wait-release-checks.js`，上限 25 分钟）——
PDA 先拿到组时，**PDA 等浏览器部署、浏览器部署在等 PDA 释放组**，互相等待。

**处置（本次实操有效）**：

1. `gh run cancel <pda-run-id>` 让出并发组 → 浏览器部署立即启动（14 分钟完成）；
2. 等 `Deploy Browser App` success 后打 tag；
3. `gh workflow run build-pda-apk.yml --ref main -f checkout_ref=a07491e…` 补跑 PDA，
   它立即通过「等浏览器部署」并成功发布。

**落地加固**：`deploy-browser.yml` 的服务器端 `flock` 等待由 300 秒对齐到 **1800 秒**
（与 PDA 一致）。一次完整部署可能十几分钟，5 分钟会在错峰发布时抢锁超时——
这正是 2026-09-16 v0.9.17 的失败原因，此前只放宽了 `docker load` 时限，漏了这把锁。

**已知限制（未做）**：把 PDA 的「发布」拆成只让发布阶段占组的独立 job，可从根本上消除互等；
但会让 APK 跨 job 传递依赖 Actions artifact（GitHub 附件存储曾出现 `HTTP 500`），
且改动无法在下次发版前验证，风险与收益不匹配。留待专门一轮实施并在下次发版验证。
标准处置已写进 `release-flowcube` 技能与 `AGENTS.md` 第 10 节。

## 本轮验证范围

- 发版前：三端版本一致性、PDA `version.json`/`build.gradle` 对齐、6 项离线门禁、后端 lint、前端 tsc。
- CI（同一 SHA `a07491e`）：Tests ✅、Security Scan ✅、Deploy Browser App ✅、Build Desktop Installer ✅、Build PDA APK（补跑）✅。
- 发版后：`release:verify` 10/10；GitHub Release 附件存在；服务器安装包 range 请求返回 206。

**未验证**：桌面端实际安装升级弹窗、PDA 真机安装 —— 需要 Windows 客户端与 Android 设备实测。
