# v0.11.4 发布 attempt 2 失败记录（2026-09-29）

> **结论：本版尚未完整发布** —— 同 SHA 的 `deploy-browser.yml` 检查失败，入口停止，**未打 tag**。
> **但生产侧并非「什么都没发生」**：迁移已执行并**留存**、应用镜像**已回退到部署前**。以下全部按日志取证。
> 原失败运行**保留、不取消**。

## 1. 应用 SHA 与工作流

- **应用 SHA：`6cb655a00495ab23e1346d4882ce156baa77edf4`**（`main` 已 push：`cfd231d..6cb655a`）
- 版本 `v0.11.4` / PDA `versionCode 148`（**尚未发布**，见 §4）

| Workflow | Run ID | 结果 |
|---|---|---|
| Tests | `36580977022` | **success**（全 job，含 9 个塑料盒专项） |
| Security | `36580977267` | **success** |
| Desktop（main 验证） | `36580977104` | **success** |
| Browser（`Deploy Browser App`） | `36580977033` | **failure**（本次失败点） |
| PDA | `36580976971` | **overall failure**（`build` success、**`wait-browser` failure**、`publish` **skipped**） |

入口（唯一 `release:prod`）自然退出：**exit code 1**，输出尾行：
`::error::deploy-browser.yml 在 6cb655a… 的检查未通过：failure`。

## 2. 部署侧实际发生了什么（日志取证，`/tmp/rel-prod/attempt2-browser-failed.log`）

- **144–149 行**：**265–268 四个迁移成功执行并留存**（`is_mixed_batch` / `scan_logs.source_container_id` /
  `sorting_bin_items` / `package_items.label_container_id`）。
- **215 行**：等待 PDA `/pda/split` 的**旧标题「塑料盒拆分」**，**20s 超时**。
- **227 行**：**「已恢复部署前应用镜像并检查健康；数据库迁移未回滚」**。

⇒ 准确表述：**迁移已执行且保留（未回滚）**，**应用已回退到部署前镜像**，**版本未完整发布**。
**不得**写成「未迁移」或「什么都没部署」。

**两端制品传输均成功**（中转日志）：Browser 镜像 `artifact 11038614421`、`205,139,217 B`、
`sha256 dcbc70e9abaa0e76802c82269b4af8e446520e1741ed038fa1f8bbe97031c1dd`（259.6s/17.2s/276.8s）；
PDA `artifact 11039743834`、`15,108,353 B`、`sha256 9124e17c8bbda543dec81d8eaaca68f6ec8f6812ed4c7e9605eff288e28b2a0d`（70.5s/3.4s/73.9s）。

## 3. 根因：**验收脚本过期**（非产品缺陷）

- 页面真实标题：`frontend/src/pages/pda/split.tsx:242` 的 `PdaHeader title="塑料盒作业"`；
  PDA 工作台入口 `frontend/src/pages/pda/index.tsx:76` 的菜单名也是「塑料盒作业」 ⇒ **菜单与页面同源一致**。
- 但 `scripts/smoke-pages.node.js:240` 仍期待旧名「塑料盒拆分」⇒ **真实页面超时**；
  `tests/browser-smoke-live.test.js` 的 fake 标题也硬编码旧名 ⇒ **fake 过、真实失败**。

**修复（最小、不放宽任何闸门）**：
- 两处均改为**读真实 `PdaHeader` 字面量**（`smoke-pages.node.js` 新增 `readPdaHeaderTitle()`；
  `browser-smoke-live.test.js` 顶部读源得到 `pdaSplitTitle`），使**夹具与产品同源**；
- **保留** `broken-pda` 负例、权限断言与**原 20s 超时**；**未**跳过页面、**未**为迎合旧脚本改产品标题；
- 运行目录已核实：`scripts/server-update.sh` 先 `ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"` ⇒
  服务端有完整 `src`、**cwd 为项目根**，动态读源在服务端成立。

**反向验证（按实际日志口径）**：临时把 **fixture 的呈现标题**改回旧名「塑料盒拆分」，而**期望仍取自读源的真值**
（「塑料盒作业」）⇒ 该 happy 流程**失败**（日志报「渲染塑料盒作业未就绪」，`# pass 5 / # fail 1`）；
**恢复 fixture 呈现后 6/6 自然通过**。即：现行**同源期望**确实能拦住这类「呈现与产品不一致」。
> 另需说明：**第二轮的正式 CI 已直接证明**——旧 smoke 期望与新页面不匹配时，真实检查会失败（本次 attempt 2 的事故本身）。

## 4. 线上现状（只读）

- `/api/health` **200 OK**；
- PDA 版本仍为 **0.11.3 / versionCode 147** ⇒ **v0.11.4 未完整发布**；
- **尚未打 tag**；桌面正式发布未进行；
- 第二次尝试的 relay / 中转 / `release-prod` / `caffeinate` **均无自身残留**（已核实）。

## 5. 下一步

- 同 SHA `6cb655a` 上完成上述脚本修复后**精确提交**，再经**唯一入口** `npm run release:prod`（第三次尝试）。
- 因 **0.11.4 尚未发布**，**无需**再递增版本号；正式门禁仍要求**同完整 SHA** 的
  `Tests`（含 9 专项）/ `Security` / `Browser` / `PDA` / `Desktop` 全部通过后才打 tag，
  随后 `release:verify` 实下载 EXE/APK 验摘要。
- **生产 schema 只读核对**：可复用**一次** SSH 会话，只查 `information_schema`（列 / 索引名 + `SEQ_IN_INDEX`）、
  `db_migrations` 的 265–268 文件名、以及回退镜像的 OCI revision；**禁止**数据库回滚、删数据或读取账款。
- **真机与物理打印未验**，单列。
