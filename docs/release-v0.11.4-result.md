# v0.11.4 发布结果（2026-09-29）

> **结论：v0.11.4 已完整发布。** 唯一入口 `npm run release:prod` 自然退出 **exit code 0**，
> 线上核对 **12/12 项一致**（期望桌面 0.11.4、PDA 0.11.4 / versionCode 148）。
> 用时 2664 秒（含检查、部署与下载验收）。

## 1. 应用 SHA 与版本

- **应用 SHA：`258806687105d47d1dd425703240598cea43e85c`**（本轮第三次尝试，`main`）
- 版本：桌面 `0.11.4`、PDA `versionCode 148`
- **tag：`v0.11.4`**（由官方入口自动创建并推送：`* [new tag] v0.11.4 -> v0.11.4`），上一个 tag `v0.11.3`

## 2. 同 SHA 工作流

| Workflow | Run ID | 结果 |
|---|---|---|
| Tests（含 9 个塑料盒专项） | `36583498520` | success |
| Security | `36583498470` | success |
| Browser（`Deploy Browser App`） | `36583498410` | **success** |
| PDA | `36583498468` | **success** |
| Desktop（main 验证） | `36583498475` | success |
| Desktop（**tag** 构建） | `36588171801` | **success** |

## 3. 原制品与摘要

| 制品 | 来源 run / artifact | ZIP（gh 元数据） | 解包后 | 完整 sha256 |
|---|---|---|---|---|
| Browser 镜像 `tar.gz` | `36583498410` / `11041275380` | 205,143,927 B | tar.gz **205,143,769 B** | `2b0d3b79169b6a75b0c09e752a5ad62df7edf32de32d582a987b1ce7ca972b77` |
| 桌面安装包 `FlowCube-Setup-0.11.4.exe` | `36588171801` / `11043270588` | 112,413,063 B | **EXE 112,412,897 B** | `10697d1322f38b3c164f5156a2cf6904049eb5c690c0319113977cc75d90887b` |
| PDA `apk` | `36583498468` / `11041131907` | 10,202,884 B | **APK 15,108,353 B** | `b0a94625cd2578d27b015cc0d17ea2810377fa7ce53ed13af0be3ffa0c09ff9a` |

> **口径**：ZIP 字节数（gh artifact 元数据，即 relay `downloading` 行）**不等于**解包后 tar.gz / EXE / APK 字节数，二者不混称。
> **EXE / APK 字节数取自线上实下载核验；镜像归档大小取自 relay 解包交付与流水线实际合并**，分别对应表中来源。

**GitHub 正式 Release**：https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.11.4
（`isDraft=false`、`isPrerelease=false`、`publishedAt=2026-09-29T15:17:00Z`）

- Release asset **实际名：`Jixu-Flow-Setup-0.11.4.exe`**，**112,412,897 B**，
  digest `sha256:10697d1322f38b3c164f5156a2cf6904049eb5c690c0319113977cc75d90887b`（与线上安装包 sha256 相同）；
- 站内 canonical 路径 `/versions/v0.11.4/FlowCube-Setup-0.11.4.exe` **是别名**，与该 asset 指向同一制品。

## 4. 线上 12/12 核对（`https://jixuflow.com`）

1. 桌面 `latest.json` = 0.11.4
2. 安装包路径 `url=/versions/v0.11.4/FlowCube-Setup-0.11.4.exe`
3. 安装包摘要 `sha256=10697d1322f3…`
4. 更新说明 `notes` 首行 `# v0.11.4`
5. `/api/app-update/latest` = 0.11.4
6. `/api/pda/version` = 0.11.4
7. PDA `versionCode` = 148
8. PDA 安装包 `available=true`
9. PDA `releaseNote` 已更新
10. `/api/health` = ok
11. **桌面下载完整性：112,412,897 字节，SHA256 一致**
12. **PDA 下载完整性：15,108,353 字节，SHA256 一致**

## 5. OCI revision 证据（生产容器）

只读取自生产主机（`docker inspect` 镜像标签），读取时刻 **2026-09-29 15:09:42Z**：

```
flowcube-frontend -> 258806687105d47d1dd425703240598cea43e85c
flowcube-backend  -> 258806687105d47d1dd425703240598cea43e85c
```

与应用 SHA、与 `deploy-browser.yml` run `36583498410` 的 `headSha` **三者一致**。

## 6. schema 证据与迁移口径

**现场只读元数据**（`information_schema.columns` / `statistics` + `db_migrations` 文件名，
未 SELECT 任何业务表、无库写）：落盘 `/tmp/rel-prod/schema265-268.txt`（22 行：4 `MIG` + 13 `COL` + 5 `IDX`）。

- **迁移文件名**：`265_inventory_containers_mixed_batch.sql`、`266_scan_logs_source_container_id.sql`、
  `267_sorting_bin_items.sql`、`268_package_items_label_container_id.sql`
- **列 / 索引**与本地迁移定义逐项一致，含：
  `inventory_containers.is_mixed_batch`（`tinyint(1)` NOT NULL DEFAULT 0）、
  `scan_logs.source_container_id`（`bigint unsigned` NULL）+ `idx_scan_logs_source_container`、
  `package_items.label_container_id`（`bigint unsigned` NULL）+ `idx_pi_label`、
  `sorting_bin_items.qty`（**`decimal(12,2)` NOT NULL**）+ `uk_task_container(task_id,container_id)` 唯一 + `idx_bin(bin_id)`

**必须分清的两件事：**

| | 第二轮（`6cb655a`） | 第三轮（`2588066`） |
|---|---|---|
| 迁移 265–268 | **四个迁移已执行并保留**（应用镜像曾回退，**迁移未回滚**） | **无新迁移**：日志「`[Migrate] 所有迁移均已执行，无需更新`」，属**幂等跳过** |

## 7. 三次尝试与两次失败记录

- **attempt 1**：`copy-conventions` 11 处用户文案 + 塑料盒专项 `finish` 的 409 `PRINT_BINDING_MISSING` 前提缺失 → 已修。
- **attempt 2**（`6cb655a`）：Tests/Security/Desktop 通过，**Browser 失败** —— 验收脚本过期（`/pda/split` 旧标题「塑料盒拆分」20s 超时，真实页面早已是「塑料盒作业」）→ 已改为**读真实 `PdaHeader` 字面量**，使夹具与产品**同源**；保留负例、保留原 20s 超时、未改产品标题。该轮**生产已执行 265–268 并留存**，应用镜像**已回退到部署前并检查健康**，**未打 tag**。
- **attempt 3**（`2588066`）：全部工作流 success，**12/12 通过**。

失败记录见：
`docs/release-v0.11.4-attempt1-failure-2026-09-29.md`、`docs/release-v0.11.4-attempt2-failure-2026-09-29.md`。

**传输路径（实测，勿误读）**：Browser 本轮**实际选路是分片 SCP，不是 relay 通道**：

- `##[warning] HTTPS 快路径不可用，回退分片 SCP`（**14:41:49**）⇒ **8 路 SCP 并行分片**写入
  `/tmp/flowcube-image-parts-36583498410-1/part-*`（生产可见 **8 个 `sftp-server`** 进程）；
- **15:06 完成合并**：分片目录与全部 `sftp-server` 消失、`tar.gz` mtime 由 22:42 更新为 23:06，随后进入部署执行阶段。

**不得**把交付日志末尾的 `relay: delivery summary {"image":"relay","pda":"relay","desktop":"relay"}`
当作「Browser 使用了 relay 传输」—— 那只是**中转通道的交付确认**。
（`relay: ready image` 的 sha256 `2b0d3b79…972b77` 与部署归档 sha256 一致，仅作**制品同一性**佐证。）

## 8. 事故遗留（未关闭）

- **旧 repair 库 `flowcube_repair20260908_test`**：曾误跑两个 repair smoke，其 `cleanup()` 对 **16 张表并集**做全表清理，**原量未知**（现 COUNT 全 0 不可推断执行前为空）；**尚未取得执行前快照或可恢复备份的证据，本轮未恢复**；已停止写入、**不再触碰**。详见 `docs/incident-repair-db-2026-09-29.md`。

## 9. 未验项（单列）

- **真机安装与实机运行**：未验。**现场清单**：`docs/release-v0.11.4-device-acceptance.md`（2026-09-30 准备；本机 `adb devices` 为空，清单内三项均标「待现场」）。
- **物理打印出纸**（打印机实际出纸）：未验 —— mock 客户端不等于实际出纸。现场清单同上（§5 标签出纸与作业闭环）。

## 10. 资源收尾（实测）

- 官方入口任务 `bfpz8eybn` **自然退出 exit code 0**（非中断、非重跑）；
- 本轮的 **entry / relay / caffeinate 均已退出**，本机无这些进程残留；
- `agent-browser` 会话列表为 **`sessions[]`（空）**；
- **只关闭自建 SSH 复用通道**：`ssh -O exit` 后 socket `/tmp/fc-cm-root@47.93.228.251:22` **已移除（absent）**；
- **共享 MySQL 3307 通道保留**（colima mux，未触碰）；其它任务（Claude.app、ChatGPT.app、用户浏览器、长期 node 进程）未触碰；
- 独立核对：相关 pid `70892` / `70932` / `70959` 均**不存在**。
