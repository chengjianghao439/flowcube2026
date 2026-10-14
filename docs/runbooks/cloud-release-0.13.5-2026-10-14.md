# 0.13.5 云端发布候选交接（2026-10-14）

状态：候选准备，未发布。v0.13.4、main/tag 的核对基线均为 `3d1b35cefb98cd143688749e893b89a54dabbf18`。远端未发现 v0.13.5；三端候选版本 0.13.5，PDA versionCode 156。最终本地候选 SHA、文件清单和检查结果以交付包内 candidate-manifest、validation-summary、git receipt 为准。本说明不能代替完整 SHA 的远端门禁和线上核验。

## 工作区与复用

- 开发目录 `/workspace/flowcube2026-cloud`，基线与前十批改动保留；既有 `/workspace/flowcube2026` 和 `/workspace/flowcube2026-v0.13.4` 也保留。没有依赖或删除 Mac 副本。
- 工具链入口 `source /workspace/flowcube-cloud/bin/toolchain.sh`，实际 Node 22.23.3、npm 10.9.9。三端 lockfile 依赖与 v13 相同，仅同步根包版本；不在正在使用的服务目录重新安装。
- 云端服务由 `python3 /workspace/flowcube-cloud/bin/services.py status|stop|start` 管理，入口核对本任务进程身份。开发 API 3000、ERP 5173；已有发布基线控制服务 3001/5174 独立保留。仅回环访问，不新增公网服务或持久访问。
- 已有 MySQL 8.0.46 合成实例 `flowcube-cloud-20261013061218-4b290514`，回环端口 32768；独立 regression、preview schema 均 160 表、`utf8mb4_0900_ai_ci`。用 `node /workspace/flowcube-cloud/bin/run.cjs regression|preview <命令...>` 加载既有私有测试配置与归属守卫；不要复制、打印或提交配置值。
- 环境变量名称包括 `NODE_ENV`、`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`JWT_SECRET`，以及既有独立实例归属证明变量。完整配置名称与合成恢复流程沿用前十批云端交接，不从生产库、备份、Mac 或其他环境取值。本次未更换凭据或扩大数据库权限。
- 后续在此任务说明“继续 0.13.5 云端发布候选”，先核对最终交付清单、当前 Git 状态和服务身份，再恢复已有配置。平台未明确保证此环境的寿命、挂载或进程持久化，本说明不作保证。

## 本地验证的范围

代表命令（在工具链加载后运行）：

```bash
node --test tests/return-payment-lock-order.test.js
npm run test:purchase-return-lock-budget
npm run test:expense-pay-backfill-integration
npm run test:party-profile
npm run test:disposal-handling
npm run test:mysql8-dev-script
npm run test:repair-smoke-instance-guard
npm run smoke:nginx-headers
npm --prefix frontend run test:unit -- --maxWorkers=4
npm --prefix backend run lint
npm --prefix frontend run lint
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run build:pda
git diff --check
```

初轮从现有 CI 提取的 78 条非数据库检查有 7 条失败，原始日志保留；均按失败原因修复夹具或用户文案后重跑相关入口。前端初轮 3067/3070，第二轮 3069/3070；最终结果单独记录，不覆盖原失败。额外修复不删除原资金、数量、范围或锁顺序断言，不降低产品规则、不跳过测试。Nginx smoke 是本云端临时容器的真实静态 HTTP 证据；React/jsdom/API mock 通过不能称为数据库业务闭环或实际浏览器验收。

288–292 已在本批独立合成库按既有流程应用。本轮只读复核两个 schema、11 个新增字段、迁移记录及两条付款记录触发器摘要；没有为发布准备再次执行 DDL、GRANT、业务写入或新建数据库。它不代替全新空库完整迁移，也不证明生产数据升级安全。具体日志位于 `/workspace/flowcube-cloud/release-preparation-0.13.5-20261014`。

## 发布阻塞与恢复边界

唯一正常入口仍为 `npm run release:prod`（`scripts/release-prod.sh`）。尚未执行该入口、推送 main/tag、触发工作流或部署。只读实际能力检查得到：

1. `gh api` 读取本仓库元数据失败：`Get "https://api.github.com/repos/chengjianghao439/flowcube2026": Forbidden`。Git 远端只读可用、连接器读取可用，不等于正常发布 CLI 可用，不能把连接器凭据导入 CLI 或换推送路线绕过预检。
2. `ssh -G flowcube-prod` 仅解析配置即 exit 255：`Bad owner or permissions on /etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf`。未更改系统权限，未用替代 SSH 配置重试，也未连接生产主机。
3. `FLOWCUBE_DEPLOY_CONFIG` 未设置，仓库 `deploy/production.local.json`、`deploy/production.json` 均不存在；`read-deploy-config.js server.host` 失败。没有可核对的正式目标配置或可信主机证明。
4. 生产备份新鲜度、压缩完整性、最近恢复证明及当前生产 schema/镜像兼容性未核实；没有读取、复制备份内容或真实数据。
5. 288–292 是加列/加表，但新增现金与普通退货执行证明具有语义约束。现有 `server-update.sh` 的旧镜像兼容判断仍只认识迁移 240 和 `io.flowcube.party-ledger-contract`；不能保证 v0.13.4 在写入新证明后可安全恢复写入。DDL 不降级；发布前须有经验证的旧写入兼容政策，兼容性不明时保持写暂停，不能自动恢复旧写入者。

最小补充条件是平台支持且已获授权的发布执行环境，具备正常 gh、受信生产 SSH 与目标配置；由授权操作方提供不含数据内容的备份/恢复和兼容性证据。涉及新凭据或安全设置时停在该步，不从其他电脑取密钥、不绕过拒绝。条件满足后仍须按完整候选 SHA 完成现有全部正式门禁和线上三端核验，不能只引用此前 v0.13.4 的绿灯。

异常合成历史 relatedEvents 权限缺口仍未修复；相关受阻外部探针以及另一个旧 SR 双草稿锁升级探针均未执行，不改名、不换执行器、不交给 CI 绕过。普通现有 CI 与它们不同。Windows GUI、PDA 真机、实际出纸仍未验证；云端 Chromium 受已记录的 sandbox/namespace 限制，没有关闭 sandbox 或调整安全设置重试。本版继续仅供合成数据安装验收。

## 交付保留

v13 原完整 ZIP 和 Library 历史保留，完整包 SHA-256 为 `d1164dbcd70d61ebac58abcfcb6b264e7071ae0b4e297836793ecd81b7a0aff9`（23,526,835 字节）。本次精简交付只省去重复的嵌套历史 ZIP 与冗长日志，保留全部累计源码、可恢复 patch、文件摘要、关键检查和阻塞；原完整文件不删改。精简 v13 文件与后续发布候选明确区分，不能把候选包称为已发布安装包。
