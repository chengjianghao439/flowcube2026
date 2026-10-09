# 打印 / 部署 / 运维

> **来源**：本文件由 `AGENTS.md` 的 §10 迁出（2026-09-19 文档体系重构，原文见 `docs/agents-md-archive-2026-09-19.md`），内容为无损搬运。
> **何时必须读**：改标签与单据打印、发布与部署链路、CI 门禁、备份恢复与服务器运维动作时。
> **约定**：能机器验证的规则一律以 `tests/` 守卫为准；本文件写「为什么」与「边界」，与守卫冲突时先核实代码，再同步两者。

---

## 历史工作树与发布取证的长期保留

清理已并入主线的工作树前，先确认提交可从 `origin/main` 找回、工作树无未提交改动且没有进程占用。逐项检查被 Git 忽略的验收输出与本机配置；需要留存的内容放入固定的私有归档目录，记录原分支、提交、逐文件 SHA-256 和归档 SHA-256，实际从归档读回逐文件校验后才移除工作树。`node_modules`、构建目录等可重建文件无需长期保留。归档不设置自动到期；恢复时先建立独立工作树，不覆盖当前 `main`。

公开仓库不得存放含本机凭据、生产取证或真实业务数据的归档、Git bundle 与清单。单机归档只防误删，不等于异地备份；在有授权的加密备份目标之前，必须明确记录这个限制。2026-09-25 的逐分支结果、归档位置与恢复方式见 `docs/worktree-retention-2026-09-25.md`。

## 现行业务与发布约束

- **B5 运单与打印说明（2026-10-03，本地实现）**：无平台编码的手工待取号/失败沿用录号；有旧平台编码只说明已配置、需核取号进度，失败后沿用原重试或录入已有单号，不由 DTO 推断平台已开通或必定成功。直连未提交平台时沿用补寄件资料与重试；已发送平台或结果待核实说明查询原单，取号中等待，不新增取号身份或自动重试。已取号不代表面单已出纸，`official_platform` 继续提示快递官方打印。运单作废确认/成功只称“本地记录”，不表示官方取消；后端直连提交及状态拒绝规则保留。打印查询保持条码业务状态与最近任务分开；排队/打印中是回执待确认，成功是客户端成功回报且需现场核纸，失败/超时先核工作站、打印机和纸张再按原补打处理。运单 DTO 没有打印任务 ID，条码查询关键字只支持记录编码/标题，故运单入口只查看物流类别记录，不宣称定位本运单原任务。最小组件回归：物流 `detail.continuity.test.tsx`、`DirectShipmentDialog.test.tsx` 与打印查询 `index.continuity.test.tsx` / `index.test.tsx` / `index.handoff.test.tsx`；不替代官方平台或物理打印证据，整批 lint/类型/构建与 GUI 由本批最终验收统一执行。

- 标签队列只接受 ZPL；单据走浏览器打印/导出。入队复用 `enqueue*LabelJob` / reprint 入口、job_unique_key 与活跃期唯一约束。
- 打印记录页与补打口径（2026-09-14 用户规则）：**补打只有一个入口——打印记录页**，其它页面（含收货/销售订单详情）不得提供补打；订单类页面只用于看进度，**销售订单不显示条码打印**（出货侧不打条码），**收货订单只保留任务进度、不展示打印记录**。记录页只列**唯一码**：入库/出库分别要求容器/箱贴最近一条 `print_jobs` 存在，且入库额外排除 `source_ref_type='plastic_box_create'`（可复用空盒即使打过标签也不进，直接调接口返回 `PRINT_BARCODE_NOT_UNIQUE`，请在塑料盒页新增的「打印条码」`POST /api/plastic-boxes/:id/print-label` 重复打印——那是重复打印不是补打）；物流取自 `print_jobs`；货架/库位标签本就不在取数范围，各页有自己的打印入口。**注意两个 `B` 码不同**：拆分散货（`container_split` / `sale_order_adjustment_return`）每次新建、指向唯一一批货，照常记录；只有空盒是复用码。无可用打印机时也要留记录（用户选方案 A）：容器标签/箱贴/面单落一条 `printer_id=NULL`、状态失败、`no printer available` 的记录，迁移 `242_print_jobs_allow_no_printer.sql` 允许 printer_id 为空；对象因此可见可补打，物理打印不受影响（claim 按 printer_id 过滤，NULL 行不会被领取）；返回值带 `unprintable`，收货/拆分的 `noPrinterCount` 与提示文案据此区分「已排到打印机」与「只留了记录」，回执统一引导到「打印记录」页补打。另修：出库计数查询把最新任务子查询别名写成 `j` 而状态条件按 `pj` 拼，一带状态筛选就报 `Unknown column 'pj.status'`，已统一为 `pj`。回归见 `tests/print-queue.smoke.test.js`；**入口归属**由 `npm run test:print-entry` 机械守住（逐个找出 URL 含 `/print-label` 或 `/reprint` 的前端端点，再定位调用页）：补打端点 `/print-jobs/barcodes/reprint` 的调用页必须且只能是打印记录页；其余 5 个入口（商品/库位/货架/塑料盒/打包页箱贴）必须在白名单里逐条写明理由且不被命中即失败；销售侧页面（`pages/sale/**` 与 `Sale*` 组件）不得引用任何打印端点；记录页的塑料盒排除必须同时出现在列表与计数两处查询。细节与未做项见 `docs/barcode-reprint-scope-2026-09-14.md`。
- **打印记录区分缺设备与超时（ACCEPT-008）**：原始 `FAILED + printer_id IS NULL + error_message='no printer available'` 派生为 `unassigned` /「未配置打印机」，提示「绑定打印机后到打印记录补打」；入库、出库、物流的标签、状态筛选、列表总数及页面上下文计数共用此口径。仍绑定打印机的 TTL 失败和客户端失联属于「超时待确认」，入库排队/打印超出配置阈值也保留超时；普通渲染失败即使没有打印机也仍为「打印失败」。取消收货优先显示已取消。不改原始任务状态、回执或自动补打行为。`test:print`、`smoke:print-queue` 的三类真实 HTTP/隔离库矩阵与条码查询页面用例覆盖；物理走纸仍需设备验收。
- **作废容器不得补打，撤回须终结「未领取」任务（2026-09-27）**：撤回收货把容器置 `VOID(3)` 并归零剩余量，但收货单只回到**「待收货(1)」而不是「已取消」**，容器既有的 `print_jobs` 也不删除——所以只按打印状态派生会把它显示成「已打印」并允许补打，打出 qty=0 的无效标签；该单重新收货还会生成新条码，两码并存互相混淆。修法分**入口侧**与**在途侧**，只堵一条都不算修好：① **入口侧**——入库补打接口在容器行锁内（`SELECT … WHERE id=? AND deleted_at IS NULL FOR UPDATE`）校验容器状态，`VOID` 抛 `PRINT_BARCODE_CONTAINER_VOID`，且**不能只靠前端禁用**（`canReprint` 只是提前告知，接口可被直接调用）；② **在途侧**——容器作废后其**尚未被领取**（PENDING）的打印任务必须一并终结，因为领取端 `claimClientJobs` 只查任务与打印机、**不校验业务对象**，已入队的任务否则会被照常领取并出纸。终结复用 `FAILED` + `container voided`（**不新增终态**：`print_jobs.status` 仍只有 PENDING/PRINTING/DONE/FAILED，全仓也没有「取消打印任务」路径），且**只动 PENDING**——PRINTING 可能已经把标签打出来了，放回可领取只会重复出纸，与 `reclaimJobsFromOfflineClients` 的取舍一致。**显示/筛选/计数必须同口径**：显示按容器状态派生 `voided`，则 `inboundStatusClause` 除新增 `voided` 分支外、**其余每个分支都要排除 VOID**（否则「筛已打印」会把显示为「已作废」的行一起收进来），`normalizeBarcodeRecordStatus` 白名单与前端状态选项同步加 `voided`，计数查询与主查询共用同一子句故自动一致。**业务边界：只收紧 VOID**；`EMPTY`（正常扣空）/待上架/待质检/拒收的容器仍有实物，补打是正当需求。
- **取货标签（`I` 码，`source_ref_type='plastic_box_pick'`）另有一层收紧（2026-09-29 批 B4，B4 补充项已订正）**：取货标签的语义是「属于**某个确定任务**的取货身份」，归属判定分两条路，都必须落在**确定的盒取货记录**上：
  - ① **容器当前锁定于某任务**：只在**那个任务**下找 `source_container_id` 非空的拣货行——进行中任务的正常补打；找不到拒绝 `PICK_LABEL_SOURCE_MISSING`。
  - ② **容器未锁定**：必须**同时**满足「容器**已被扣空**（`EMPTY(2)` **且余量 0**）」+「该容器**唯一一条**盒取货拣货行、其任务为**已出库终态(7)**、且未请求取消」才放行。这正是取货标签的设计场景——变量取自**真实 PICK 行**而非容器余量，本就为了货已出库、容器被扣空转 `EMPTY` 并解锁之后仍能打出**原取货量**（详见 `enqueuePickLabelJob` 注释）。**取消 / 进行中 / 容器未扣空 / 多条候选 / 任务缺失**一律拒绝 `PICK_LABEL_NOT_IN_TASK`：归属不确定时宁可不打，**绝不从同一容器的其它后续任务猜**（容器未扣空时根本不进这条分支，不拿它去覆盖别的状态）。
  **这不改变上一条 VOID 边界**——上一条说的是通用库存标。实测（批 B4 + B4 补充项）：取消归还后原任务**不能再**补打该码；已出库 `EMPTY` 后**可以**按真实 PICK 补打原取货量；取消归还后被下一任务当**普通整件**复用的码（`source_container_id` 为空）**不得**认回旧标签。回归 `npm run smoke:pick-label-reprint-lifecycle`（3 项，全真实链：`finish` 入队 → **真实 `claim-client` + `complete-client`** 收口箱贴 → `pack-done` → 任务出库 7）。
  锁序：补打**只取 `inventory_containers` 单行锁**（当前任务锁 `locked_by_task_id` 与容器状态在**同一条 `FOR UPDATE`** 里读出，判据只此一个来源），`voidReceipt` 走「`inbound_tasks` → 库存维度 → 容器」，补打不取前两者、不构成环，也**刻意不加维度锁**（单资源锁比多资源锁安全）。**显示层必须把「业务状态」与「最近任务结果」当成两个维度**（2026-09-27 GUI 验收发现：作废曾把任务结果整个覆盖掉，VOID 行只剩「条码已作废」，看不出这张标签当初打没打出来）：入库条码行同时给出 `barcodeStatusKey`（行级业务状态：作废/取消/正常）与 `latestJob.statusKey`（**最近一次打印任务自身的结果**），前端「条码状态」列只画前者、「打印机 / 最近任务」列只画后者。作废终结的任务结果是 `voided_job` → 「未出纸（容器已作废）」，**不得复用「打印失败，可尝试补打」**（补打入口对作废容器是拒绝的）；其余任务结果（已打印/打印失败/超时/未配置打印机）语义保持不变。
回归 `npm run test:print-barcode-void`（纯离线：派生/归一化/逐分支筛选/两个维度互不覆盖）与 `npm run smoke:print-barcode-void`（独立库：拒绝且不新增任务、终结 PENDING、两种并发顺序、产品补打确实持锁、作废行两状态并存）；前端另有组件与格式化用例。八项反向破坏均精准红。
- 打印成功/失败回执均须携带本次 `ackToken`，以 PRINTING + 令牌 CAS 更新；缺令牌返回 400、旧令牌返回 409。旧客户端不能再无令牌上报失败，应同步更新桌面消费者；状态不明保留超时人工确认，不自动重打。领取查询与 CAS 都排除过期任务。
- 面单只使用明确的 waybill 用途绑定，缺绑定不入队；普通标签最后兜底及环境指定设备仍限目标仓或全局设备。显式用途绑定沿用已有契约。
- 重复入队命中活跃任务时，接口返回原队列内容快照，不返回新模板重绘结果。入队 copies 必须为 1–100 的数字整数，缺省为 1；桌面将多份内容组装为一次 RAW 提交。单份保留原始模板，模板含 ^PQ 时拒绝再叠加任务多份，避免数量相乘；提交后核销失败只重试回执。
- ZPL 业务字段统一清洗 ^/~ 和控制字符，可信模板正文保留；变量仅单次回调替换，不递归展开。条码保留合法首尾空格。画布标签及内置兜底统一由后端随包中文字体生成黑白点阵，PNG 预览与 ZPL ^GFA 使用相同像素；模板 layout.dpi 支持 203/300，旧模板默认 203，^PW/^LL 按该 DPI 输出。条码使用整数点模块宽及静区，HRI 计入元素高度，非法/太小/越界须报错。手写 ZPL 与历史任务快照保留原处理规则。实现与验收范围见 `docs/label-raster-2026-09-11.md`；库存退货标签入队回归从实际 ^GFA 点阵独立解码条码，不能再检查 ZPL 明文包含条码；真实走纸仍需设备验收。
- `smoke:print-queue` 必须在第 3 节独立测试库运行，覆盖回执、过期、并发、路由、份数及事务回滚；模拟 RAW 不等于真机验收。2026-09-09 七项修复及修复前证据见 `docs/label-print-audit-2026-09-09.md`。
- 桌面客户端拉取打印任务，按打印机绑定、client_id 和心跳派发，与登录账号无关；保留 claim 行锁/CAS、ack_token、超时回收。
- 桌面打印客户端的成功心跳与空领取是周期性技术请求，不写入新的操作日志；失败请求、实际领取、打印完成与失败回执仍记录。操作日志页面和导出隐藏历史成功心跳及领取请求，原有数据库记录保留供排障；判断实际打印次数以打印任务与回执为准。
- HTML 单据模板 image 与 ZPL 标签分开；编辑器预览与打印渲染、旧 layout_json 默认值保持一致。
- 条码标签 type 5–10 支持按需拖入商品身份、仓库、库位、批次/日期及对应货架/箱子信息，原默认布局不变。真实预览与打印共享取值；缺字段留空，容器取数复用调用事务，保存不固化样例业务值。字段清单与取值口径见 `docs/label-optional-fields-2026-09-09.md`。
- 打印模板新建/编辑默认用对应类型最新可查看业务记录辅助排版与预览；取数同时要求模板查看与原业务查看权限，沿用仓库范围。无记录/无权限保留当前空白或既有占位，网络错误明确提示并可重试；真实记录缺字段不混入示例值。初始空画布有记录时提供可撤销的默认字段排版，不覆盖已有布局或后续编辑；保存仅包含字段与几何，不包含样例业务值。空数据回归使用本测试新建仓库范围，不假设共享测试库全局为空；全局打印类型绑定夹具须保存并完整恢复原记录，不重复插入已有唯一键。取数只读、不入队，类型/登录会话隔离，隐藏页不新取数。接口、类型映射与验证见 `docs/print-template-real-preview-2026-09-09.md`。
- `main` 是发布来源，push main 触发检查与部署；浏览器、桌面发布前必须等待**实际待发布 SHA** 的 Tests 与 Security Scan 成功，旧 SHA/失败/取消/超时不放行。桌面手动 checkout_ref 也用实际 git HEAD，版本输入必须匹配其 package。PDA 还需同 SHA 浏览器部署成功；仅推 main 不等于桌面发版。
- **部署临界区共用 `flowcube-server-deploy` 且不取消执行中的任务**：浏览器部署、桌面正式发布与 PDA 的 publish job 串行；桌面 push main 仅验证构建，PDA 等待浏览器的 job 不占部署组。服务器 `flock -w 1800` 是兜底。浏览器部署步骤 150 分钟 / job 210 分钟，预算覆盖上传 2700 秒、合并 610 秒、等锁 1800 秒、部署 2400 秒及回退宽限 600 秒，另容纳 HTTPS/中转尝试 545 秒和预检等开销；不能只增加内层而让外层先强杀。
- 跨境直连不可用时，已授权操作端可中转**本次 run/attempt 的同一 GitHub artifact**：可先创建同路径 `.relay.pending` 申请最多 300 秒等待，再验证 GitHub artifact ZIP 的 `digest`、唯一归档条目和大小，再通过复用 SSH 上传到 `/tmp/flowcube-images-<run>-<attempt>.tar.gz.relay.partial`，上传完成后原子改名为 `.relay`。接收器在直连前及下载失败后检查该文件，必须匹配 runner 计算的归档字节数与 SHA256 才采用；符号链接、大小/摘要不符均拒绝。不得本地重建镜像或绕过后续 OCI revision、迁移、页面和回退门禁。CI 收尾清理本轮中转文件。
- GitHub 草稿 Release 可能无法按 tag 查询；附件核对与重试清理须使用已取得的 Release ID，发现已有草稿则复用，不能重复创建。若桌面安装包已上线且附件已上传，仅草稿转正失败，运行 `recover-release-asset.yml`，传原 tag、tag 构建 run ID 和已核验的正式 HTTPS 站点（不依赖历史 `ERP_ORIGIN` Secret）：只下载原 CI artifact，校验原构建 SHA、同提交测试/浏览器/PDA、线上包摘要及 GitHub 附件摘要后转正，不重新构建或改写线上包。原失败运行保留，补发布运行独立记录。
- PDA 与桌面包统一调用 `scripts/transfer-release-asset.sh`：PDA 传递本轮 APK artifact ID，桌面 EXE artifact 必须在正式发布前上传；接收器只接受指定的唯一 APK/EXE 文件名，并核对 runner 字节数与摘要，SCP 回退同样复算摘要。中转路径分别为 `/tmp/flowcube-pda-<run>-<attempt>.apk.relay`、`/tmp/flowcube-desktop-release/v<version>/<原始EXE文件名>.relay`；可提前以 `.relay.partial` 写入再原子改名，所有中转路径由 EXIT trap 收尾。
- 账款与对账验收使用拆分后的 `/payments/{payable,receivable}` 和 `/reports/reconciliation/{payable,receivable}`；旧入口会重定向，不可断言停留在旧地址。真实浏览器夹具须读取项目 HashRouter 别名规则，不能用不跳转的模拟页面掩盖失配。
- 镜像 HTTPS 接收器须兼容生产 Python 3.6：文本输入使用 `universal_newlines=True`，临时文件清理捕获 `FileNotFoundError`；禁止依赖 `text=True` / `unlink(missing_ok=True)`。完整成功路径兼容回归见 `tests/deploy-artifact.test.js`。
- **跨境上传按实际方向核对**：runner → 服务器上传和服务器 → 外网下载不能互相推算。历史记录的入站聚合约 97 KB/s 只说明当时链路慢，不证明当前网络完全不可达，也不保证增加并行度一定加速。镜像优先由服务器通过 HTTPS 下载本次 CI 的临时 artifact，150 秒下载预算、1100 秒远程执行预算（含最多 900 秒中转等待）；签名 URL 仅走 stdin，GitHub token 留在 runner。ZIP 只允许唯一预期归档，核对大小和 SHA256 后原子落盘；无 Python/curl、网络错误、摘要不符均明确降级。失败时保留 8 片并行 SCP 上传；单片和整批同为 2700 秒，避免 900 秒的单片先结束。按序合并后核对字节数，随后仍由 `server-update.sh` 核对 SHA-256 与 OCI revision。SSH 控制指令复用连接，八个 SCP 数据流各用独立控制连接以保留并行 TCP。`always()` 清理步骤只清本次 run/attempt 的归档、bootstrap、接收脚本、下载临时目录和分片目录，并删除本次 Actions 临时镜像 artifact（保底保留期 1 天）；SSH 续行中不得插入注释截断远程命令。
- **用户已取消固定 15 分钟目标，可靠性与可恢复性优先**：统一入口 `npm run release:prod` 等同 SHA 的 Tests、Security、Browser、PDA、桌面 main 验证构建完成后才推桌面 tag，再等待对应 tag 的桌面发布并核对线上版本。桌面 Release 附件失败必须报红；main 验证构建不能代替 tag 发布。最终逐包流式下载 EXE/APK、核对 SHA256，不再仅检查清单字段；现行代码每包最多 120 秒 / 1 GiB，取消总时长目标不改变已有阶段超时。网络降级或 runner 排队须如实报告。历史实施与本地证据见 `docs/release-flow-speed-2026-09-22.md`。
- 发布技能已补齐原包恢复、实际发布顺序和结果记录要求。一次成功、恢复完成与真机验收分别报告；跨境人工中转不能算无人值守验证。一次构建、统一编排与同地域产物存储属于待实施建议，见 `docs/release-pipeline-optimization-2026-09-22.md`；v0.10.3 的实际耗时与失败记录见 `docs/release-v0.10.3-result.md`。
- **正式发布固定使用本机代理中转**：唯一入口 `npm run release:prod` 在 push 前读取 `HTTPS_PROXY`（或 `FLOWCUBE_RELAY_PROXY`）并预检 `flowcube-prod` SSH 别名（可由 `FLOWCUBE_RELAY_SSH_TARGET` 指向实际别名）；缺配置或 SSH 不通立即停下。Mac 必须保持在线。入口启动有界 watcher，绑定同 SHA、push 事件、main/tag、工作流及 run attempt；从 GitHub 下载原 artifact ZIP，验证摘要与唯一成员，再经复用 SSH 交付，生产接收器独立核对 runner 的大小/SHA256。旧 attempt 的同名 artifact 必须等新 attempt 产物出现后才处理。CI 的 HTTPS/SCP 保留为内部有界回退，操作者不在多条发布命令之间选择；记录实际采用路径，`ready` 不能代替接收完成。退出清理本任务进程、暂存文件和 SSH socket。不新增付费资源；v0.10.8 的直连/SCP 失败与中转恢复证据见 `docs/release-v0.10.8-result.md`。
- **页面验收运行依赖离线交付**：`scripts/browser-smoke` 锁定 `playwright-core@1.55.0`，与预装 `mcr.microsoft.com/playwright:v1.55.0-noble` 一致。CI 随后端镜像安装，门禁从运行容器复制至本次临时目录、只读挂载，不在生产 npm 下载。每轮验收复用一条浏览器 API 连接，换账号清上下文，PDA 独立标签，成功/异常关闭浏览器和容器并清理依赖副本；保留全部页面、权限和错误断言。版本升级必须同时更新依赖锁、镜像及运行时版本断言，并跑 `npm run test:browser-smoke`。
- **PDA 等待预算随浏览器部署对齐**：`wait-release-checks.js` 仅在必需工作流包含 `deploy-browser.yml` 时默认等 225 分钟，PDA 步骤上限 230 分钟；普通 Tests/Security 检查仍为 25 分钟。目标 SHA 没有工作流仍在 5 分钟快速失败，失败/取消仍立即拒绝，不能把加长等待当成放松发布门禁。契约与执行回归在 `tests/deployment-resources.test.js`、`tests/audit-tooling.test.js`；本次问题与证据见 `docs/harness-changes-audit-2026-09-22.md`。
- **`Build PDA APK` 的「等浏览器部署」与「持有部署组」必须分处两个 job**：把「等待组内另一个成员完成」的步骤放进持有该部署组的 job 就是自锁——PDA 等浏览器部署、浏览器部署等 PDA 释放组，GitHub 不报错、只表现为长期 pending。拆分方式、artifact 传递与守卫见 §0.1；事故经过见 `docs/release-v0.9.17-result.md`。
- 发版必须读取 `release-flowcube` 技能。同步三端 package/lock、PDA versionName/versionCode 与 `backend/apk/version.json`，以及官网更新摘要 `frontend/src/pages/landing/updates.ts`；同版本重跑不应虚增版本号或发布时间。脚本用实际存在路径，不照搬旧 `.Codex/skills` 路径。
- **发版收尾的加固（当时做法）**：`Build PDA APK` 曾有 push 路径过滤；补跑用 `checkout_ref` 以实际检出的提交作为「等浏览器部署 / 服务器 HEAD 校验」的基准，`wait-release-checks` 对「该提交根本没有运行」约 5 分钟快速失败。v0.11.0 后路径过滤已移除，现行触发规则见下文。桌面 EXE 上传走 `scripts/publish-release-asset.cjs`（确保 Release → 删同名 → 重试/超时 → 校验远端大小 → 最后 `draft=false` + latest），不用会挂起且不校验的 `gh release upload`。PDA 工作流 `preflight` 在构建前核对版本清单，再比对线上 `/api/pda/version`；同 versionCode 换包会被拒绝。发版后必须跑 `npm run release:verify -- --origin https://<生产域名>` 实际下载并核对 EXE/APK；禁止在本机重建或复制安装包。历史背景见 `docs/release-v0.9.20-result.md`。
- 桌面图标在 `desktop/build/`；Windows 保持 `signAndEditExecutable: true` 写入图标和元信息，并用 `signExecutable: false` 保持当前不签名策略，不能以关闭资源编辑代替关闭签名。Windows CI 打包后执行 `scripts/verify-desktop-icon.cjs` 校验实际 PE 内嵌图标摘要。
- 生产安装包由 Windows CI 构建；迁移由 `scripts/server-update.sh` 部署链执行。不能直接改服务器代码，不能默认跳过发布门禁。
- Docker 构建上下文由根 `.dockerignore` 排除真实环境/密钥、本机依赖、历史安装包、日志和工具目录；运行配置从部署环境注入。新增构建依赖需确认未误排除，不能为构建成功把真实 .env 或 node_modules 加回上下文。
- GitHub runner 构建带 SHA 标签与 OCI revision 的 Linux amd64 镜像，优先通过 HTTPS 拉取归档、失败回退并行 SCP；生产禁止重新编译。部署在同一锁内固定 SHA、保存运行镜像 ID，检查空间与归档 SHA-256、加载并核对镜像 revision、等待 MySQL 健康、一次性容器迁移，再切换应用。迁移前失败或已兼容数据库的健康/门禁失败恢复旧应用镜像并检查健康；迁移开始但未完整成功时保持后端停写。首次应用 240 记账契约、实际旧镜像缺少 `io.flowcube.party-ledger-contract=1` 标签，或停写后兼容性尚未核实时，失败保持停写；重试也不能恢复不传单位 ID 的旧后端，须核实迁移并启动兼容新后端。数据库 DDL 不自动回滚，首次部署无旧版本、回退或权限恢复失败均明确报告。部署门禁低磁盘时禁止清除回退镜像，直接失败。人工脚本入口要求显式 EXPECTED_COMMIT 并查询 GitHub 同 SHA 检查，推荐通过 workflow_dispatch 执行。
- 发布辅助负载边界：Docker 请求由 `scripts/lib/runtime-guards.sh` 设时限；处于 CI 总时限内时共享信号范围，保证清理/回退可执行，宽限为 600 秒；页面验收顺序执行，每次 1 CPU / 1 GiB（不额外交换）/ 256 进程，容器内 14 分钟，超时/中断清理本次容器，按数据库兼容边界回退应用或保持停写。浏览器镜像须预装，部署前检查存在且 `--pull never`；磁盘不足直接失败，禁止门禁自动 prune。监控用独占锁拒绝重叠，Docker 5 秒、TLS 10 秒，失败必须记为异常。详见 `docs/DEPLOY.md` 和 `tests/deployment-resources.test.js`。这些改动已随 v0.9.3 于 2026-09-05 正式部署；候选 89 项部署/运维/CORS/客户端回归通过，同 SHA 的 Tests、Security 与实际生产页面/对账门禁均成功。实际容器资源限制、镜像提交号、线上清单与发布结果见 `docs/release-v0.9.3-result.md`。
- 生产权限验收账号（2026-09-09 用户明确长期保留）：`smoke_limited`（ID 8）恢复启用，仅保留 dashboard.view / inbound.order.view 两项权限，发布完成后不删除。口令已轮换为随机值，原会话撤销；发布脚本通过 `SMOKE_LIMITED_USERNAME` / `SMOKE_LIMITED_PASSWORD` 安全配置读取，不再内置固定口令，也不自动恢复其他已删除账号或跳过权限验证。GitHub Secrets 在部署时注入门禁容器，缺少任一配置立即失败。该长期授权替代 v0.9.10 的一次性恢复约定，见 `docs/release-v0.9.13-result.md`。
- 桌面更新清单由 `scripts/release-desktop.js` 写入 `/var/www/flowcube-downloads/latest.json`；`backend/downloads/` 已废弃。
- 桌面更新使用可信 HTTPS 清单，由主进程重新取清单并绑定 version、URL、sha256；下载后及启动安装前均验摘要。无摘要不能自动安装，系统证书校验失败默认拒绝；取消按 IP/域名放行任意证书的旧行为。根组件消费更新事件，preload 保留订阅前待通知结果并支持清理监听。
- PDA 已发布状态由不入 Git 的 `backend/apk/published-version.json` 指向唯一 APK；CI 先落安装包再原子替换清单。`backend/apk/version.json` 是构建目标/旧部署兼容清单，不能让浏览器 git reset 把未发布 APK 的版本提前对外公布。PDA 发布只更新挂载产物，不重置 Git 或重建后端；部署回退时将 version.json 原子恢复为已发布清单，兼容不识别 published-version.json 的旧镜像。
- 审计目录中的原始`.log`保留工具输出字节与摘要，`.gitattributes`仅对这两轮归档日志关闭源码空白检查；业务源码、配置和Markdown继续检查空白。
- Gitleaks 审计证据误报只允许豁免经核实的固定非认证值，不能排除整个证据目录；当前四个测试调拨幂等键及一份源码SHA256采用精确匹配，原因写在`.gitleaks.toml`。
- 依赖审计安装/网络/JSON 错误必须失败，不能视为零漏洞；扫描完整依赖树，直接和传递依赖的所有 high/critical 均阻断，不能用 omit=dev 排除 Electron 分发运行时。v0.9.14 起上传依赖 multer 最低为 2.3.0，前端工具链 js-yaml 4.x 锁定安全补丁 4.3.2；上传与 Logo 接口只接收单文件、拒绝未使用的 multipart 文本字段，数量超限返回 HTTP 400（`test:upload` 离线回归并纳入 Tests CI），升级后仍扫描完整依赖树。当前 HashRouter 使用 React Router 7；后端 qs 安全补丁由 overrides 固定最低修复版，移除覆盖前重新审计上游依赖范围。
- **依赖升级要按 major 分别核对行为，不能拿「CI 全绿」当通行证；未升级项必须逐项记录可核对理由**：2026-09-18 合并 14 项 CI 全绿升级（含 express-rate-limit 8、eslint 10 两个 major，均实测无行为差异），并刻意保留 zod 4 / vite 8 / @types/node 26 / @zxing 0.23 四项——理由与失败证据见 `docs/dependency-upgrade-2026-09-18.md`。两条实测教训：**失败检查名会误导工作量**（vite 8 的检查名叫「静态检查（lint + 类型）」，实际死因是 `npm ci` 的 ERESOLVE——插件 peer 还要求 vite ^6，属插件生态协调升级）；**依赖类型必须跟随运行时**（项目运行时锁 Node 22，故不采纳 @types/node 26，否则等于用未来运行时的类型检查今天的运行时）。另：前端 `tsconfig.app.json` 的 `lib` 已由 ES2020 显式提到 ES2022——`lib` 只管类型可见性、不改构建产物（emit 目标仍由 `target` 与 Vite 的 esbuild target 决定），此前能通过只是靠 `@types/node` 的 lib 引用顺带提供，属对传递依赖的隐性依赖。
- **部署磁盘预检必须自解释（2026-09-19）**：`deploy-browser.yml` 上传前的 `df -Pm /tmp APP_PATH ≥ 6144MB` 预检原为 `test "$(df …)" -ge 6144`，余量不足时 ssh 只返回 1、无任何输出，与「SSH 连不上」日志上完全一样；11:04 起连续 3 轮失败只能事后推断（`8a2a748`/`d7cb1cc`/`a654aac`，线上停在 `ea13046`）。现先打印各挂载点实际余量再判定，并区分「磁盘不足 / SSH 取不到 / df 返回空」；守卫见 `tests/deployment-resources.test.js`（反向验证：退回静默 `test`、把 awk `NF<2` 分支改回 `exit 1`（`exit` 会跳到 `END` 被覆盖成 0）、删掉 SSH 失败分支，都必须失败）。**低磁盘时人工清理后重跑，不得自动 prune 或清回退镜像**；经过、清理记录与根因修复见 `docs/deploy-disk-precheck-2026-09-19.md`（根因：桌面发布的中转目录 `/tmp/flowcube-desktop-release/${tag}` 从不清理，累积 1.3G；现已用 `EXIT` trap 自清并由守卫守住）
- 运维容器解析复用 `scripts/lib/ops-common.sh` 的 `resolve_container()`，不硬编码 Docker 容器名。备份先写临时文件、验证后落正式文件；失败清残留并告警。
- 恢复演练默认总时限900秒、768m内存、1 CPU、256进程，禁网络与额外swap；正常、超时或TERM退出清理自有容器及匿名卷，外层exec GNU timeout保证信号传递。新鲜度按备份文件修改时间判断，自动演练默认拒绝超过 48 小时的文件（`BACKUP_MAX_AGE_HOURS`）；显式指定历史备份只检查恢复能力并提示过期。没有新销售单不能判定备份损坏。MySQL 连接数探针在容器内认证，查询失败或无效值必须记录异常，不得回退为零；隔离回归见 `tests/ops-monitor-restore.test.js`。
- 慢查询监控按慢日志的 UTC `# Time:` 只统计当前日志最近24小时条数，数量进入性能摘要和日报，不再按条数即时报警。日志读取失败或时间格式不受支持时仍告警，历史日志不得为消警而清空。
- 备份可恢复性口径（2026-09-14 事故后）：mysqldump 可能把触发器函数体残留的结尾分号导出成 `... ); */;;`，直接导入会 1064。`scripts/restore-check.sh` 导入前只把该分号移出可执行注释（不改写备份文件），并透出 MySQL 真实报错以区分「文件损坏」与「导入语法问题」；`docs/runbooks/failure-recovery.md` 的手工恢复用同一口径。备份是否可恢复以完整导入临时 MySQL 为准，不能只看文件存在或 `gzip -t`。隔离回归见 `tests/restore-trigger-normalize.test.js`。
- 库存漂移巡检只报警，不自动修库存缓存掩盖根因。调度器与服务器 cron 是不同机制，改动时检查 scheduler、install-cron 和部署同步链路。
- 故障处理先读 `docs/runbooks/failure-recovery.md`，确认现场与备份后执行已授权操作；测试与生产严格区分。
- CORS 规则集中在 `backend/src/config/cors.js`：`CORS_ORIGIN` 支持逗号分隔的精确来源，Electron 的字符串 `null` 由 `CORS_ALLOW_NULL_ORIGIN` 单独控制；内置 Android PDA 当前源码默认来源为 `https://localhost`。不要为兼容客户端而打开任意来源反射。2026-09-05 发布 v0.9.3 时，生产仍保留既有反射兼容配置；这是当时快照，不代表当前生产配置。收窄来源前须先只读核对现行配置并完成实际客户端验证；测试见 `tests/cors-policy.test.js`，部署说明见 `docs/DEPLOY.md`。
- 2026-09-04～05 生产环境核查与恢复见 `docs/production-environment-check-2026-09-04.md`：用户授权普通重启后，9 月 5 日 00:12 网站/SSH 恢复。已完成现有 50 GiB 云盘的系统分区扩展（使用率约 66%）、.env 0600、SSH 密钥登录、宿主 Node 22.23.2，以及停用仅支持单队列网卡上不适用的 ecs_mq 优化；配置/数据库/分区表已备份至服务器和 Mac。生产 MySQL 实测 8.0.45，135 表，232 份 SQL 无缺失，另有 1 条历史迁移记录。备份误报、连接数探针和 CORS 配置能力修复已随 v0.9.3 部署（CORS 实际来源配置未收窄）；自动异地备份目的地尚未配置。云盘读写受限已由云平台确认，具体占用进程根因仍不明，避免重跑无时限的整盘 Docker 统计。

### 2026-09-23 PDA 原生扫码构建门禁

- PDA 构建工作流在 Capacitor 同步后、正式 APK 签名前运行 `:app:testDebugUnitTest`，覆盖厂商扫码模式恢复和广播条码校验；`tests/deployment-resources.test.js` 守住执行顺序。此门禁证明 JVM 逻辑与 Android 工程可构建，现场设备扫码仍须独立验收。实现与边界见 `docs/pda-scanner-broadcast-2026-09-23.md`。

### 2026-09-22 打印授权与静态响应头整改

- 打印任务详情、三类条码补打、领取、完成、失败、重试都检查用户仓库范围；领取在候选 SQL 内过滤，不能先领取再隐藏。无仓任务对限仓用户拒绝访问，完成仍须通过原工作站与 ackToken 校验。
- 原始 `POST /print-jobs` 不接受业务来源引用；业务标签使用对应业务入口读取真实来源。显式打印机同时检查打印机仓库范围，全局共享打印机沿用既有共享语义。PDA 原始打印携带当前设备会话仓库。
- `docker/nginx-security-headers.conf` 由 Dockerfile 复制到 `/etc/nginx/snippets/security-headers.conf`。Nginx 每个自设 `add_header` 的 location 都显式包含安全头片段，防缓存头覆盖继承。`npm run smoke:nginx-headers` 用独立 Docker 容器检查真实 200/404/502 响应及缓存策略，完成后删除本测试容器。
- 前端 Vitest 升至 4.1.11，修复开发测试服务相关依赖公告；锁文件与 Node 22 的 `npm ci`、完整前端验证一起验收。此修改不代表生产部署或真机验收。

- 发布等待中的 GitHub 状态读取最多尝试 3 次：网络/超时及 HTTP 429/502/503/504 以 1 秒、2 秒间隔重试，仍受总等待预算限制；401/403/404、损坏结果及 CI 失败立即拒绝，不输出原始网络异常中的地址或凭据。行为回归位于 `tests/release-orchestration.test.js`。

### 2026-09-23 CI SSH 与跨域加固

- 四个 SSH 工作流只使用 GitHub Actions 变量 `FLOWCUBE_SSH_KNOWN_HOSTS` 中独立核对的服务器公钥材料；`scripts/setup-ci-ssh-trust.sh` 离线验证目标主机/端口，开启 StrictHostKeyChecking，不使用网络扫描兜底。缺失或不匹配即阻断，上传清理也须可信配置成功后执行。服务器轮换主机键时先经服务器控制台等独立渠道核验再更新变量。
- 变量内容为标准 known_hosts 公钥行；非 22 端口主机字段用 `[host]:port`。v0.11.0 发布准备时，现有本机固定的主机键与经严格 SSH 连接读取的服务器本地公钥指纹一致，仓库 Actions 变量已设置；这只证明当前信任材料就绪，不代表部署成功。
- `release:prod` 在 push 前调用 `scripts/check-release-ssh-trust.sh`，读取仓库 Actions 变量并以部署配置的实际域名/端口运行同一离线校验器，不改本机 SSH 配置。v0.11.0 首次部署因变量只有 IP、CI 使用域名而失败；本机 SSH 别名可用不证明 CI 的主机键查找可用。对应回归见 `tests/release-orchestration.test.js`。
- `Build PDA APK` 对每次 main push 运行前置门；同版已发布时跳过构建，发布提交只改后端迁移也不会缺 PDA 运行。构建并发组绑定目标 SHA，后续提交不能取消仍在构建的发布提交；`[skip ci]` 提交仍不作发布目标。路径过滤漏触发与并发绑定由 `tests/release-orchestration.test.js` 守住。
- 本机中转对失败的大分段先有界重试，再只把该分段拆成 256 KiB 子区间；其余已完成分段保留在本轮下载中。完整 ZIP 和原文件仍按 GitHub 摘要、大小、唯一成员及接收端 runner 预期摘要核对，不能以分段完成数代替验收；见 `tests/local_release_relay_test.py`。
- smoke 凭据由 `ssh-smoke-stdin.sh` 经 NUL 分隔 stdin 传输，远端 shell 内建 read 后导出，不再出现在 SSH 命令参数。仍属于远程进程环境，不能将此描述为消除了所有凭据可见性。
- 浏览器部署的复用 SSH 从首个预检连接起配置 `ServerAliveInterval 30`、`ServerAliveCountMax 10`；仅给后续命令加参数不能改变已建立 master 的策略。配置阶段通过离线 `ssh -G` 输出四项连接策略，不输出完整配置。HTTPS 接收失败进入原有界兜底前，仅释放此 runner、本目标的 master，重新建立连接。主机键、包摘要、迁移、页面门禁及回退预算保留。守卫 `tests/deployment-resources.test.js` 用真实 OpenSSH 解析和原预检脚本执行验证，删除保活项或把释放命令改为仅查询会失败。
- 2026-10-08 第二轮部署中，中转归档已在服务器验收，而 runner 接收命令等满 1100 秒，后续复用连接的兜底命令再超时；当时未进入迁移/切换。首连接缺少应用层保活已离线复现，连接具体在哪个网络节点失效尚无抓包证据，不能据此认定某个防火墙或运营商故障。[OpenSSH 文档](https://man.openbsd.org/ssh_config#ServerAliveInterval)说明默认 0 不发送应用层保活，次数上限控制无响应连接的退出；本次发布的恢复结果另见版本结果文档。

### 2026-09-26 打印统计与打印机健康的仓库范围

- 打印任务列表 `findAll` 与详情 `findById` 早已按 `req.user.warehouseIds` 过滤，但 **`/stats`（`getStatsCounts`）与 `/printer-health`（`listPrinterHealth`）原是无参数调用**：限仓用户打开打印中心，统计照样报出全公司的待打/失败任务数，健康页列出全部仓库打印机的错误率与延迟。同一份数据、两个出口、两套口径——列表看不见的，统计照样看得见。
- 现两处都接 `scopeWarehouseIds`（controller 传 `req.user?.warehouseIds ?? null`）：**统计按 `print_jobs.warehouse_id`**、**健康按打印机 `printers.warehouse_id`**，与列表同口径——`/stats` 的 `pending` 必须等于 `/api/print-jobs?status=pending` 的 `pagination.total`。不限仓（`roleId=1`，`warehouseIds` 为 null）保持全量；限仓时 `scopeFilter` 生成 `IN (...)`，绑 null 仓的全局共享打印机与「无打印机」`print_jobs` 行不出现在限仓结果里，那是给不限仓账号看的。
- 回归 `tests/print-jobs-warehouse-scope.smoke.test.js`：§A 用增量断言对历史残留免疫、§B 统计与列表同口径且列表无他仓单据、§C 健康过滤并逐台回库核对打印机绑仓。
- 生产 CORS 启动时拒绝反射与 `*`，部署前须明确 Web/PDA 来源及独立 Electron null 开关。v0.11.0 发布准备中已保留服务器本地原配置备份并设置 Web、当前内置 PDA 及 Electron 所需来源；更改在应用重启后生效，实际客户端仍须验收。

## 关键操作回执事务与「事务内读打印任务」（2026-09-29 批 C2）

完成箱子（`finish`）的回执与业务现为**同一 conn、同一事务**。打印任务是本事务刚 INSERT 的行，回执构建必须用**同一个 conn** 读，因此：

- `print-jobs.query.findById(id, scopeWarehouseIds = null, exec = pool)`
- `print-jobs.dispatch.getDispatchHintForJob(printerCode, jobId, exec = pool)`

两者新增**可选** `exec`（不传时仍是 pool，**旧调用行为不变**）；其中打印机 / 打印客户端读取**也走 exec** —— 调用方已持事务连接时不再借 pool 的第二条连接，避免自阻塞与读到旧快照。

**注意**：`findByIdWithExecutor` 缺行是**直接抛 `PRINT_JOB_NOT_FOUND` 404**，`getDispatchHintForJob` 里的 `if (!job)` **兜不住**这个抛错。所以事务内若误用 pool 读未提交的 job，后果是 **404 导致整笔回滚**，**不是**"读到 unknown / 缺失值"。

回归 `tests/pack-finish-receipt-tx.smoke.test.js`（9 项，含 commit / 回执写入 / 回执构建读三种故障注入各自全量回滚 + 原键可重试）。**本批改动了共用的打印任务查询，发版前全量门禁待跑。**

## 标签入队失败的两类降级计数（**仅批 A「还原整件」已分开；其它调用点尚未分开**）

`buildLabelBody` 先取默认 ZPL 模板，取不到（例如模板解析失败会降级返回 `null`）再回退**本地光栅渲染 worker**。入队失败时只写 `status=3` 的失败记录供补打，**不回滚**调用方事务（收货 / 容器拆分 / 还原整件 / 完成装箱都是「货已经动了」的事实记录）。

两类失败原因必须**分开计数**，否则界面会说错原因：

| 原因 | 触发 | `error_message` | 计数字段 |
|---|---|---|---|
| 无可用打印机 | 该仓库/用途解析不到可用 `printers` | `NO_PRINTER_REASON` | `noPrinterCount` |
| 渲染失败 | 光栅 worker 的 `error` / `exit`（`LABEL_RENDER_FAILED`）、繁忙（`LABEL_RENDER_BUSY`）、超时（`LABEL_RENDER_TIMEOUT`） | `label render failed: <code>` | `renderFailedCount` |

注意：**改坏模板构造不出「渲染失败」**——模板解析失败只会降级返回 `null` 并回退光栅渲染，不抛错。要真实触发只有 worker 故障/繁忙/超时。回归见 `tests/label-render-degrade.smoke.test.js` 与 `smoke:plastic-box-batch-a`（后者用 `require.cache` 打桩注入，默认透传真实实现）。

**适用范围（务必限定，勿外推）**：截至 2026-09-29，**只有批 A 的「还原整件」**（`plastic-boxes.service.js` 的 `repack`，判据 `/label render failed/.test(errorMessage)`）按上表把两类原因分开计数。

**其它既有调用点尚未分开**，典型例子：收货 `backend/src/modules/inbound-tasks/inbound-tasks.command.js:659` 仍是
`if (!job?.id || job.unprintable) noPrinterCount += 1`——**渲染失败也会被计入「无可用打印机」**。旧 `split` 等调用点同样未区分。
**本轮不顺改**这些调用点；不得据本节推断「全系统两类降级已统一口径」。

## 2026-09-29 · 发布门禁的「页面标题必须与产品同源」（attempt 2 事故）

`Deploy Browser App` 在 v0.11.4 的第二次尝试中失败，**根因不是产品缺陷，而是验收脚本过期**：

- 页面真实标题早已是 `frontend/src/pages/pda/split.tsx` 的 `PdaHeader title="塑料盒作业"`
  （PDA 工作台菜单 `pda/index.tsx` 也是同名的「塑料盒作业」，**菜单与页面同源一致**）；
- 而 `scripts/smoke-pages.node.js` 仍期待旧名「塑料盒拆分」⇒ **真实页面 20s 超时**；
- `tests/browser-smoke-live.test.js` 的 fake 标题也硬编码旧名 ⇒ **fake 流程通过、真实页面失败**。

**做法（已实施）**：两处均改为**读真实 `PdaHeader` 字面量**
（`smoke-pages.node.js` 新增 `readPdaHeaderTitle()`；`browser-smoke-live.test.js` 顶部读源得到 `pdaSplitTitle`），
使**验收夹具与产品同源**；**保留**负例（`broken-pda`）、权限断言与**原 20s 超时**；
**不**跳过页面、**不**为迎合旧脚本改产品标题。服务端可行：`scripts/server-update.sh` 先
`ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"`，**cwd 为项目根**且含完整 `src`。

**反向验证（按实际日志口径）**：临时把 **fixture 的呈现标题**改回旧名，而**期望仍取自读源真值** ⇒ 该 happy 流程**失败**
（日志报「渲染塑料盒作业未就绪」）；**恢复 fixture 呈现后 6/6 通过**。
另：**第二轮正式 CI 已直接证明**旧 smoke 期望与新页面不匹配时会失败（即本次事故本身）。

**部署侧的准确表述（务必照此）**：该次 **265–268 四个迁移已执行并留存**，
**应用镜像已回退到部署前并检查健康**（日志原话：「已恢复部署前应用镜像并检查健康；**数据库迁移未回滚**」），
**版本未完整发布、未打 tag**。**不得**写成「未迁移」或「什么都没部署」。
详见 `docs/release-v0.11.4-attempt2-failure-2026-09-29.md`。


## v0.12.0 首轮发布受阻与本地构建依赖候选（2026-10-03）

首轮0244640同SHA业务Tests与桌面验证通过，Security audit失败，浏览器/PDA发布门禁拒绝；线上最近核对0.11.5，无本版tag或生产迁移。用户批准调整构建依赖后，第二候选使用固定builder26.15.3/get5.1.0兼容适配及单点安装补丁，保留超时/503重试/代理/TLS/摘要；裸override已撤回，不与当前适配方案混称。18项真实下载专项及最低Node22.12实际运行通过，官方NSIS下载/固定摘要/提取通过，不能当Windows安装证明。适配补丁的原/结果文件摘要都固定，安装布局或版本漂移拒绝；当前签名禁用，未来签名旁路另验。新回归 `npm run test:builder-download-compat` 在独立 CI job 安装桌面依赖、显式补丁后执行。

样式用Tailwind4官方PostCSS接点并保留旧主题/视觉尺度，真实浏览器旧基线对比由 `npm run test:style-compat` 在browser-smoke-runtime job执行；隐藏项/汇总栏/响应式及交互已扩至2070项0差异；桌面hover/focus与弹窗、现代Chromium触摸模拟通过，独立SPEC/QUALITY已ACCEPT覆盖范围，代表电脑业务页18张浅深截图已观察，对账来源跳转自然成功，PDA仓库页/往来页仍未补验。四目录完整audit本地均0；远端新SHA门禁还未运行。Tailwind4最低Chrome111，而PDA默认minWebView60，实际设备内核未核实，不能把电脑验收当旧PDA兼容或提前发布。正式入口、TLS/摘要与回退门禁不变；首轮失败、中间撤回及现候选依据见 `docs/release-v0.12.0-result.md`。

2026-10-04 用户在获知PDA内核最低要求与待验边界后再次明确发布，当前轮次按先自动验收、设备到场后补验的授权推进正式门禁；不把设备内核尚未确认写成兼容通过。此前保留本地候选的安排已由最新发布指令更新。

第二轮f88d801安全/业务门禁19job通过，夹具样式hover能力检查失败，浏览器/PDA发布被挡住，没有生产切换。仅调整测试浏览器初次启动的桌面hover能力设置，实际鼠标/媒体双断言与2070旧基线保留，必须重新经新SHA完整门禁；详见本版结果。

最终发布完成（2026-10-04）：14e97aa同SHA Tests20job、Security6job、Browser/PDA/main桌面以及v0.12.0 tag桌面均success；正式入口和独立release:verify均12/12，EXE/APK下载摘要匹配，生产前后端revision及269–275迁移/20索引/21外键最终结构只读核对通过。PDA0.12.0/150；真机内核111最低要求、扫码/Windows更新弹窗/纸张仍待验。原失败与中转耗时保留，详见本版结果。

 2026-10-06 安全扫描的发布与打印契约

- 手动桌面/PDA 目标只接受 main 历史中的冻结 SHA/版本 tag；构建无发布凭据，PDA 签名与发布分别在 fresh runner，发布下载精确 artifact ID 并校验 SHA/run/字节。NSIS/Gradle 校验前不得执行归档内容。所有外部镜像使用固定摘要，发布前生成并保留镜像 SBOM/来源记录。详见 `docs/security-release-remediation-2026-10-06.md`。
- PDA fresh signer 的 `apksigner` 可为签后 APK 生成独立 `<APK>.idsig`（V4 增量安装侧文件），而当前发布只交付 APK。签名及 APK 验签成功后只移除本次准确输出路径的普通、非符号链接 `.idsig`，再绑定签后字节来源；不关闭 APK 签名方案、不扩大 artifact 白名单、不通配删除或忽略另名条目。`tests/security-release-artifact.test.js` 执行实际 workflow shell，覆盖正常侧文件、另名侧文件、符号链接以及删除处理块后的失败反证。本地 SDK 34/合成密钥实签名已复现生成侧文件及原清单拒绝；正式 SDK 35/发布密钥、最终 SHA 的签名及上传结果仍由远端运行单独核验。
- SBOM 扫描两镜像串行，各容器限制 2 GiB 内存（含 tmpfs、不追加 swap）、2 CPU，缓存 tmpfs 上限 1 GiB 且显式 `mode=1777`，继续禁止网络、额外 capability 和根文件系统写入。固定 Syft 镜像原 `/tmp` 为 root 的 0755；挂载未声明权限时，runner UID 不能创建缓存或提取层。按 [Syft 1.54.0 官方配置](https://oss.anchore.com/docs/reference/syft/configuration/) 设置 `SYFT_CHECK_FOR_APP_UPDATE=false`，不放开网络。Syft 缓存全部未压缩镜像层；固定 Node amd64 层、当前锁定的生产依赖和 Linux musl canvas 的最低合计 294607349 字节已超过旧 256 MiB，尚未计字体、npm cache 及新增层。`tests/security-image-sbom.test.js` 校验实际 CLI 预算、UID 与临时目录权限，并反证旧上限和删除权限设置。固定摘要的真实 Syft 已对两份含真实 npm 包元数据的 tiny 镜像归档复现旧权限失败、修后生成两份非空 CycloneDX SBOM；这不代表最终应用镜像 SBOM，完整镜像仍须最终 SHA 的 CI 实扫，扫描失败不得跳过。
- Gitleaks fallback 与 Syft 容器显式使用 runner 的 UID/GID 写报告；固定镜像默认 root 在 `cap-drop=ALL` 下不能写 runner 拥有的 755 绑定目录。两套 CLI 回归保留删除用户绑定即失败的反证，不通过放宽报告目录权限或扫描豁免解决。
- 独占临时 MySQL runner 就绪只认容器内 `127.0.0.1:3306` 的 TCP `SELECT 1` 使用本批随机口令认证成功；初始化时 `--skip-networking` 的临时 socket server 不算就绪，`mysqladmin ping` 在 Access denied 时仍返回 0。保留 90 轮重试、2 秒失败间隔及末次确认，单次连接限 2 秒，最后认证未通过即非 0；不输出口令、不改变实例归属门与精确清理。入口守卫及 stub CLI 覆盖延迟就绪、永久认证失败、仅 socket 服务和删除 TCP 绑定的失败反证；真实独占实例及最终 SHA CI 单独验证。
- 常规应用部署保留唯一、running/healthy 的现有 MySQL 容器，停写前对该容器执行 TCP 认证 `SELECT 1`；口令只在容器内通过 `MYSQL_PWD` 展开。现有容器停止、不健康、缺健康状态、重复或认证失败均明确失败，不自动恢复、重建或按新版 Compose pin 拉取数据库镜像。没有容器时，先确认声明为固定摘要且该镜像已在本机，再以 `--pull never --no-deps` 首次启动并核健康与实际 SQL；缺镜像须在维护窗口预装，禁止联网兜底或改用浮动 tag。首次观察设 30 秒截止点、最多 15 次，不重复启动；执行中的命令仍受各 5 秒超时与 10 秒强杀宽限约束，单次连接限 2 秒。应用切换及回退均带 `--no-deps`，数据库镜像升级另走维护窗口。`tests/audit-deployment.test.js` 执行隔离 CLI 的真实部署 shell，覆盖两种启动路径、认证/健康失败，以及删除健康门或应用 `--no-deps` 的失败反证；真实数据库与生产容器是否保持原 ID/启动时间由独立运行核验。

2026-10-07 发版前实时 audit 新发现三项公告，按官方修复版本最小升级：[proxy-addr 2.0.8](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)、[Capacitor Android/Core 8.4.3](https://github.com/advisories/GHSA-rvm3-566m-v7fv)、[source-map-js 1.2.2](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。Android/Core 固定同版满足 peer；保留现有 CLI、Gradle、SDK 和自定义插件。四目录完整 audit 归零；前端 1714 用例、lint、类型、ERP/PDA 构建与 sync、原生单测和 clean assembleRelease 均通过。8.4.3 SystemBars 的键盘/安全区行为须真机后补；同 SHA CI、签名和下载摘要仍分别核验。

Gitleaks 全历史初次识别三项 generic-api-key，实际是两份合成 GUI 证据 URL 的 requestKey（供应商退款创建/收到款），以及离线容器拆分的固定幂等请求键。只精确匹配这三个已核实完整值，不豁免目录、规则或其他密钥；原失败报告与修后扫描分别保留。
- 打印工作站须经具有管理权限的管理员注册随机凭据；所有消费同时核登录、站凭据与本次 claim/ack，旧公开 ID 不再鉴权。升级需迁移 277 与新版桌面注册；模板/ZPL 预算超限明确拒绝，业务标签渲染失败仍降级、不回滚业务事务。详见 `docs/security-print-remediation-2026-10-06.md`。

## HTML 单据的长企业资料文本（2026-10-04，R1）

`TemplateRenderer` 的既有文本元素是绝对定位固定框，原 `overflow: hidden` 会裁切超长名称/地址。本轮仅为 `customerName`、`supplierName`、`receiverAddress` 接入局部 `PartyPrintText`：保留完整数据，按实际文本框 scroll/client 尺寸换行并逐步缩小字体，物理字号下限 8pt；原模板已小于 8pt 时保持原字号，不再缩小。模板保存值、其它元素、表格分页、条码和 ZPL 引擎沿用原实现。

达到下限仍溢出时，预览提示增大对应模板文本框；`OrderPrintOverlay` 的应用打印按钮等待既有图片解码和字体就绪后，先同步恢复100%物理尺寸再复测，确认溢出则拒绝发起打印并恢复员工原预览缩放，保留本次物理尺寸的改模板提示。固定像素padding和整数DOM尺寸不是严格等比，不能用放大预览的fit代替打印尺寸；合法打印后也恢复原缩放，beforeprint不覆盖按钮保存的原缩放。未挂载字段不参与判定；隐藏/零尺寸框标记为尚不能测量，不能当成 fit 或溢出，给出可解释提示，显示后复测。不可测量不会误封其它合法模板；原 KeepAlive 活跃与打印代次守卫仍生效，等待中的重复点击只接受最新请求。此保护针对应用打印按钮，不能宣称拦截浏览器系统菜单、外部打印端或所有物理裁切原因。

`TemplateRenderer.profile.test.tsx` 使用真实组件与受控 DOM 测量适配器，覆盖完整长文本、可适配、8pt 仍溢出、原小字号、预览缩放、隐藏后显示和字体等待后的重新测量；新增非等比例固定padding/点转像素/整数DOM尺寸回归，证实150%可容纳而100%溢出时不发起打印并恢复原缩放、合法打印afterprint仍恢复。修正前新场景自然exit1，修正后与既有Overlay测试合计16/16自然exit0。jsdom 适配器不代表真实排版或物理出纸，字体、打印介质、页面边界和实际样张仍待 GUI/现场验收。名称/地址 Excel 换行及行高详见财务主题文档。

## 钉钉服务器与作业异常预警（2026-10-04 本地改动）

服务器文本使用 `scripts/lib/ops-alerts.js` 正确JSON编码，保留换行、引号和反斜杠；正文最多8000 UTF-8字节，超长显式提示，仍核对HTTP和钉钉errcode。宿主cron需要Node22，不依赖后端容器。公共库只在当前 PATH 找不到 Node 且 `/usr/local/bin/node` 可执行时补入该系统目录，保留调用方已选定的 Node。2026-10-07 生产宿主以 cron 默认 PATH `/usr/bin:/bin` 复现旧路径失败；候选公共库在同一受限环境下实际运行 Node 22.23.2，合成消息编码与接受响应校验通过，未发送通知。部署后还须核对安装脚本摘要。异常消息依次显示影响、异常（严重项优先）、恢复项、数据安全、服务、资源和处理位置；正常日报一行。收到日报只证明日报任务执行，不能推出监控正常或备份可恢复。

监控保留独占锁和有界探针，`.monitor.state`升级为0600 JSON并兼容旧ok/bad状态。当前观察与已成功通知分开，新故障、等级变化和逐项恢复立即通知；发送失败不确认，下次巡检重试；持续异常仍按`REMIND_HOURS`（默认24小时）提醒。首次升级无法还原旧故障明细，因此对当前异常重报一次。容器ID变化或计数减少重取基线；只按近30分钟采样新增重启次数报警（默认大于3），初次采样不拿历史累计数报警。

数据安全摘要只读取备份文件大小/修改时间与自动恢复演练结果；文件体积达标不代表可恢复。监控找不到达标文件或最新文件超过`BACKUP_STALE_HOURS`（默认30小时）进入严重异常；日报另检查今日文件。自动恢复演练在原校验完成后写`.restore-check.status.json`，失败写失败状态；显式历史文件验证不覆盖自动记录。缺少记录显示未记录，有记录超过8天提示核对。日报要求最近监控采样不超过15分钟，过期写明待核实。

应用侧旧经营预警替换为作业异常预警（`operation-alerts.service.js`），每5分钟扫描（仍可用`DINGTALK_ALERT_INTERVAL_MS`调节）。首批只覆盖销售出库当前打包/待出库任务的最新箱标签失败或排队超时，以及有有效拣货/分拣任务且距最后作业8小时/4小时的波次；最近作业取波次/任务更新时间与成功扫码时间。取消、改单挂起、已结束任务、已补打替代的历史失败不提醒。每类查询最多最近50项，每条消息最多10项，超界明确提示页面核对；显示单号、仓库、箱码、持续分钟和处理位置，链接仅为辅助入口。群机器人无逐人仓库授权过滤，应配置到获准查看这些作业信息的群。

按资源与异常阶段去重，新增/变化即推送，持续同项24小时提醒；发送失败不确认。应用去重为进程内状态，应用重启后当前异常可能重报一次。普通缺货/呆滞/逾期账款仍保留原站内通知；库存缓存漂移独立报警继续保留，报警本身不推进作业、重打标签或修复库存。登录后的跳转逻辑本批没有调整。

新回归`tests/ops-alert-notifications.test.js`已接入Tests CI的运维回归步骤。实际钉钉接收、同SHA远端CI及生产cron/应用生效需发版后独立核验，不能从本地测试推断。

## 2026-10-07 · 组合页发布验收

现结和月结页面共用「供应商往来」「客户往来」标题；采购、报表、仓库运营也通过 `MergedPage` 注入组标题。`smoke-pages.node.js` 对九条已覆盖的组合路由，同时核可见 h1、对应 nav 的 `aria-label`、可见 `aria-current=page` 链接文案与精确目标 hash；四条财务路由继续核应付/应收、现结/月结的可见业务说明。不得仅匹配导航里常驻的子页文字。原 20 秒等待、错误标记、受限账号 403、PDA 新标签与浏览器 finally 清理继续生效。

真实 Chromium 夹具独立读取 `mergedPageGroups.ts` 和实际财务 `COPY.description`，呈现新组合页结构。旧标题、错误当前视图、错误 href、错误财务组件均须失败；原 PDA/权限/渲染错误反例保留。第五次发布在旧完整标题等待中超时，276–280 迁移已执行，应用镜像已回退并核健康，数据库没有回滚；不能称作完整发布成功。最终同 SHA 发布门禁仍须在实际新应用上执行。


### 2026-10-09 销售默认打印金额兼容

销售打印保留历史 `totalAmount` 毛额含义，新增 `discountAmount` 与 `netAmount`（展示折后订单金额）。仅销售字段面板增加这两个可选字段；采购、退货、标签/ZPL不改金额绑定。明细单价复用单价格式入口，金额仍两位。

前端读取模板时，`withSalePrintTotals` 仅对销售/A4/默认种子名称/系统创建、且整个布局精确等于079历史默认种子的模板提供内存副本：原毛额改标“商品金额”，追加折扣与订单金额，顺移备注。列表读取与详情读取相同，不写库、不执行迁移、不改变已执行079；任何已改字号、坐标、表格、页边距、元素或非销售的模板保持原样。自定义模板可由用户在编辑器主动使用新增字段，不自动保存；重复读取不重复加元素。长地址超出原固定文本框仍沿用 PartyPrintText 物理字号下限与拒绝裁切保护，需要增大该模板文本框，金额修复不绕过该保护。

对应前端测试：`api/print-templates.sales.test.ts`、`lib/orderPrintData.test.ts`、`lib/format.test.ts`、`commercial/printCommercial.test.ts`。
