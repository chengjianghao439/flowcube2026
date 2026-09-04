# 极序 Flow 整体系统扫描报告

审计日期：2026-09-04。代码基线：`main`，提交 `76c8496f12d802457195e2e9f684c1720dbf1d44`；后端、前端、桌面端版本均为 **0.9.1**。

> **修复状态（同日更新）**：F01–F17 与三个验证缺口已在本地工作区落实修复，详情与本轮验证见 [系统修复报告](system-audit-fixes-2026-09-04.md)。下文保留 `76c8496` 的修复前证据，位置行号对应基线，不代表当前源码或线上已部署状态。

## 1. 整体判断

系统已具备完整的 ERP/WMS 主链路、统一库存引擎、权限与设备控制、自动化测试和发布流程。审计基线源码可以通过静态检查和构建，既有业务回归也通过。**但本次发现了会影响库存数量、销售承诺、会计金额和管理员权限的确定性缺陷，建议先修复高优先级问题再扩展功能。**

本报告整理 **17 项问题：12 项 P1、5 项 P2**，另记录 3 项验证与门禁缺口。P1 表示应优先修复的数据一致性、安全或发布可靠性问题；P2 表示重要的功能或完整性缺陷。分级是修复顺序，不代表线上已经发生事故，也不等同于 CVSS 评分。

其中四组关键结果已经通过**实际 MySQL 8、当前引擎/服务代码和隔离夹具**复现：

| 场景 | 应有结果 | 实测结果 |
|---|---|---|
| 收退货 10 件，只检合格 1、不合格 1 | 合格 1、拒收 1、待检 8 | 容器记录合计只剩 **2** |
| 采购 10 件，先上架 5 件 | 总供应仍为 10 | 可占量为 **15**，引擎接受占用 15 |
| 现货订单出库，另有预计库存订单占用 5 | 该订单预占仍为 5 | 预占缓存为 **0**，有效预占明细仍为 **5** |
| 账套 1 存在借现金、贷应付各 100 的凭证 | 本期借贷各 100；资产与负债各 100 | 试算和资产负债表均为 **0**，仍显示平衡 |

这些复现从显式业务中间状态构造夹具，直接调用实际引擎或服务；不是完整 PDA 点击流程，也不是生产数据核验。数据库复现全部在事务结束时回滚。

## 2. 范围与方法

- 检查后端业务分层、库存/预占/审批引擎、采购销售与退货链路、会计和权限、前端 API 与路由、PDA 扫码、Electron 更新/打印、迁移、CI 和部署脚本。
- 对库存、财务权限、客户端分别开展独立审查，再集中复核调用链及可复现性。重点深读高风险路径；不声称逐行审阅全部源码。
- 将当前提交导出到 `/tmp`，仅复用本地依赖；不复制真实 `.env`。静态检查、构建、数据库回归均在该隔离源码目录运行。
- 使用 Colima 独立 Docker context，启动无宿主业务目录挂载的临时 MySQL **8.0.46**，绑定本机独立端口。没有在本机现有 MySQL 9.6 或生产库运行测试。
- 对部分缺陷使用真实源码 + 内存 SQL 适配器或 Node VM 复现；这类验证证明控制流和参数行为，不证明并发锁、网络或原生系统表现。
- 只读查看当前提交对应的 GitHub Actions 状态；未 SSH 登录生产、未发布、未修复业务代码。

### 当前规模快照

| 指标 | 实测 |
|---|---:|
| 后端业务模块目录 | 60 |
| SQL 迁移文件 | 231 |
| 迁移声明的业务表 | 131 |
| 全新 MySQL 8 执行迁移后的表数 | 132，含 `db_migrations` |
| 前后端权限码一致性 | 181 / 181 |
| 后端 `app.use('/api/...')` 挂载项 | 60；不是 HTTP 接口总数 |
| 已跟踪 `.js/.ts/.tsx/.java/.sh/.sql` 文件 | 1,063 个，134,182 行；含测试、SQL 和受版本管理的生成代码 |

以上是本次代码/新建测试库口径，不能替代生产表数、生产迁移记录或完整 API 数量。旧迁移编号仍有 057/064/089 重复与 008/009/040 缺号；当前编号检查将其作为已知历史基线接受。

## 3. 已完成验证

### 静态、构建和安全扫描

| 验证 | 本次结果 |
|---|---|
| 后端 ESLint | 通过 |
| 前端 ESLint | 0 error、5 warning；均为组件与常量共同导出相关警告 |
| TypeScript app 配置检查 | 通过，显式使用 `tsconfig.app.json` |
| 前端 Vitest | 3 个文件、26 个用例通过 |
| 标签、打印、权限、凭证映射、操作日志 | 已执行现有根目录测试命令，全部退出 0 |
| 状态规则检查 | 343 passed |
| 迁移编号检查 | 通过，保留上述历史告警 |
| ERP 与 PDA 前端生产构建 | 均通过；未生成 Windows 安装包或原生 APK |
| 前后端标签镜像一致性 | Node 22 下跳过；另用本机 Node 26 补跑，5 例通过 |
| Gitleaks | 当前提交导出的文件扫描，按仓库配置执行，0 条发现；不含完整 Git 历史及真实环境文件 |
| npm 依赖漏洞审计 | **未完成**：三端请求超时，重试仍超时；不能据此判定无已知漏洞 |

13 个静态/构建命令全部退出 0。标签镜像补跑、秘密扫描与定向缺陷复现单独统计，不与业务回归混为一个“覆盖率”。

### 业务回归

两套独立测试库分别执行 231 个迁移，schema 检查通过。24 个测试命令累计输出 **717 passed / 0 failed**，另外 3 个数据库准备/检查命令成功。

| 测试 | 通过数 | 测试 | 通过数 |
|---|---:|---|---:|
| 主链路 | 49 | 并发保护 | 83 |
| 销售改单 | 57 | P0 回归 | 41 |
| P1 回归 | 44 | 仓库范围 | 41 |
| PDA 设备会话 | 28 | 财务 | 108 |
| 呆滞处置 | 27 | 开票额度 | 10 |
| 退款 | 14 | 会计 | 11 |
| 会计期间 | 14 | 打印清理 | 4 |
| 报表数值 | 6 | 授信出库 | 6 |
| 采购审批 | 6 | 审批流 | 30 |
| 授信放行 | 11 | ATP | 8 |
| 工资税额纯函数 | 7 | 搜索范围 | 8 |
| 用户角色 | 8 | 库存集成 | 96 |

已有测试重视主链路、借贷平衡和幂等，但没有覆盖本报告发现的部分数量处理、ATP 到货/履约衔接、报表已知金额，以及原生客户端地址/事件连接。**全绿测试与本报告缺陷同时成立。**

### 远程 CI 状态

同一提交的 6 次工作流运行均成功，包括 [Tests](https://github.com/chengjianghao439/flowcube2026/actions/runs/33863377209)、[浏览器部署](https://github.com/chengjianghao439/flowcube2026/actions/runs/33863377123)、[Security Scan](https://github.com/chengjianghao439/flowcube2026/actions/runs/33863377114)、[PDA 构建](https://github.com/chengjianghao439/flowcube2026/actions/runs/33863377229)，以及 [桌面构建](https://github.com/chengjianghao439/flowcube2026/actions/runs/33863377144) 和 [tag 桌面构建](https://github.com/chengjianghao439/flowcube2026/actions/runs/33863387592)。这里仅确认运行状态，不表示已验证线上业务健康、用户收到更新或安装包实际运行。

## 4. 问题清单与处置建议

证据标识：**DB** = 本次实际 MySQL 8 定向复现；**模拟** = 当前源码在 VM/内存适配器执行；**代码** = 静态调用链和配置确认。以下描述修复前行为；各项实现与验证状态已链接到修复报告。

### F01 · P1 · 销售退货部分质检破坏数量守恒【DB + 模拟】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

收一箱 10 件后，提交合格 1、不合格 1，代码把原箱改为合格 1、另建拒收箱 1，未保存待检 8 件。若只提交合格 5，则整个 10 件容器被转为待上架，第二次质检被拒绝。前端允许这些部分数量输入。

位置：[return-tasks.service.js:260](/Users/chengjianghao/flowcube/backend/src/modules/return-tasks/return-tasks.service.js:260)、[同文件:282](/Users/chengjianghao/flowcube/backend/src/modules/return-tasks/return-tasks.service.js:282)、[PDA 输入:228](/Users/chengjianghao/flowcube/frontend/src/pages/pda/sale-return-receive.tsx:228)。修复时应保留合格、拒收、未检三个分量，并断言拆分前后总量守恒。

### F02 · P1 · 部分上架重复计算采购供应，可超占【DB + 模拟】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

采购 10 件只上架 5 件时，现货立即增加 5；预计量查询却只扣“整单已结算”的上架量，仍保留预计 10。因此真实占库引擎接受 15，最终供货只有 10。

位置：[expectedStock.js:48](/Users/chengjianghao/flowcube/backend/src/utils/expectedStock.js:48)、[inbound-tasks.putaway.js:167](/Users/chengjianghao/flowcube/backend/src/modules/inbound-tasks/inbound-tasks.putaway.js:167)。预计量应扣已经进入实物库存的数量，不能等待整张收货任务结算。

### F03 · P1 · 出库截断合法 ATP 预占，预占缓存与明细分离【DB + 模拟】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

现货 5，A 占现货 5，B 占预计 5；A 出库后，本应保留 B 的 5。代码仍执行旧约束 `reserved=LEAST(reserved, quantity)`，把缓存清零，B 的有效预占和预计绑定仍为 5。到货后可用量会虚高。

位置：[inventoryEngine.js:198](/Users/chengjianghao/flowcube/backend/src/engine/inventoryEngine.js:198)。应统一现货预占、预计预占及履约定义，按有效预占维护投影；不能通过仅截断一个字段掩盖不一致。

### F04 · P1 · 采购撤回/驳回绕过预计销售绑定保护【代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

采购状态 2 或 5 可被销售使用预计量，但撤回确认和审批驳回没有检查有效销售绑定。尚未建收货任务时可退回草稿，再修改数量，导致供应退出 ATP、销售仍保持已占。取消和短装路径已有保护，覆盖范围不完整。

位置：[purchase.service.js:384](/Users/chengjianghao/flowcube/backend/src/modules/purchase/purchase.service.js:384)、[同文件:460](/Users/chengjianghao/flowcube/backend/src/modules/purchase/purchase.service.js:460)。应统一供应退出/减量的保护及锁顺序，覆盖撤回、驳回和明细重建。

### F05 · P2 · ATP 重复扣绑定，履约后绑定不关闭【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

现货 0、采购 10，先占 5 后，预计量已扣绑定 5，投影又扣总预占 5，可占量变成 0，而非 5。另一条路径中，销售履约只核销预占明细、不关闭预计绑定；短收 5 并供给销售出库后，采购剩余仍可能因旧绑定无法结案，已出库销售又不能普通释放。

位置：[expectedStock.js:71](/Users/chengjianghao/flowcube/backend/src/utils/expectedStock.js:71)、[containerEngine.js:497](/Users/chengjianghao/flowcube/backend/src/engine/containerEngine.js:497)、[reservationEngine.js:158](/Users/chengjianghao/flowcube/backend/src/engine/reservationEngine.js:158)。应明确未到量、未兑现绑定与现货预占的分别含义，并按到货/履约数量关闭依赖。

### F06 · P1 · 试算平衡与资产负债表 SQL 参数错位【DB + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

两条 SQL 的账套占位符在最后，参数数组却先传 `companyId`，实际账套过滤收到月底日期。查询空结果随后被补成全零并判定平衡。本次账套 1、202609 期间借贷各 100 的真实分录已复现两张报表全零。

位置：[accounting.ledger.service.js:57](/Users/chengjianghao/flowcube/backend/src/modules/accounting/accounting.ledger.service.js:57)、[同文件:269](/Users/chengjianghao/flowcube/backend/src/modules/accounting/accounting.ledger.service.js:269)。修复参数次序，并新增已知金额、跨期间、跨账套回归；只断言借贷相等抓不到此缺陷。

### F07 · P1 · 有重置密码权限的非超管可接管超管【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

前提是非超管被授予 `user.reset_password`。接口只校验动作权限，controller 未传操作人，service 可直接更新超管密码；随后可用新密码登录超管。生产是否存在这样的权限分配尚未核验。

位置：[users.routes.js:55](/Users/chengjianghao/flowcube/backend/src/modules/users/users.routes.js:55)、[users.controller.js:56](/Users/chengjianghao/flowcube/backend/src/modules/users/users.controller.js:56)、[users.service.js:164](/Users/chengjianghao/flowcube/backend/src/modules/users/users.service.js:164)。应在服务层增加操作人/目标角色保护，同时复核删除、禁用等目标账号保护。

### F08 · P1 · 撤回收货归零后，生成凭证仍保留旧金额【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

采购已生成 100 元凭证，合法撤回全部收货后，库存和应付重算归零；凭证 builder 将零金额来源过滤掉，生成循环不再遇到原凭证，原借库存/贷应付各 100 元仍保留。模拟确认第二次生成写入数为 0，旧分录未变。

位置：[inbound-tasks.void.js:108](/Users/chengjianghao/flowcube/backend/src/modules/inbound-tasks/inbound-tasks.void.js:108)、[voucher-engine.js:189](/Users/chengjianghao/flowcube/backend/src/modules/accounting/voucher-engine.js:189)、[同文件:471](/Users/chengjianghao/flowcube/backend/src/modules/accounting/voucher-engine.js:471)。应显式处理已有来源归零/消失，保留反冲痕迹并遵守结账期间锁定。

### F09 · P1 · 红字凭证可以被普通删除，冲销关系断裂【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

未结账期间生成的红字凭证使用 `source_type='manual'`；删除服务只限制来源为 manual，前端也显示删除入口。删除红字后，原凭证仍为已冲销且无法再次冲销，但总账包含原凭证金额，原业务金额重新生效。

位置：[accounting.voucher.service.js:190](/Users/chengjianghao/flowcube/backend/src/modules/accounting/accounting.voucher.service.js:190)、[同文件:225](/Users/chengjianghao/flowcube/backend/src/modules/accounting/accounting.voucher.service.js:225)、[前端入口:346](/Users/chengjianghao/flowcube/frontend/src/pages/accounting/vouchers/index.tsx:346)。应保护所有冲销关联凭证，撤销冲销须作为完整状态转换处理。

### F10 · P2 · 改价未匹配审批流时返回 500【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

未配置、停用审批流或金额未匹配时，审批引擎正常返回 null；改价服务直接读取 `inst.instanceId`，触发 TypeError 并回滚。应返回明确配置提示，是否允许无流程提交需遵循业务审批规则。

位置：[price-change.service.js:125](/Users/chengjianghao/flowcube/backend/src/modules/price-change/price-change.service.js:125)、[approvalEngine.js:94](/Users/chengjianghao/flowcube/backend/src/engine/approvalEngine.js:94)。

### F11 · P1 · PDA 销售退货扫码上架无法提交【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

条码解析保留 `I000123` 等完整字符串，页面却 `Number(parsed.code)`，得到 NaN；下一步因 `!containerId` 直接返回，API 不会发出。库位有相同转换。应通过条码解析/查询取得真实容器与库位 ID，并校验归属，不能假定条码数字就是数据库主键。

位置：[sale-return-putaway.tsx:51](/Users/chengjianghao/flowcube/frontend/src/pages/pda/sale-return-putaway.tsx:51)、[同文件:60](/Users/chengjianghao/flowcube/frontend/src/pages/pda/sale-return-putaway.tsx:60)、[barcode.ts:44](/Users/chengjianghao/flowcube/frontend/src/utils/barcode.ts:44)。

### F12 · P2 · 独立桌面/PDA 的令牌续期请求地址错误【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

业务请求使用已配置 API 地址的实例，续期却使用裸 `axios.post('/api/auth/refresh')`，未继承 baseURL。打包桌面的 file origin、独立 PDA 的 localhost origin 都指向错误目标，到期续期失败后会登出。同源浏览器和 Vite 代理可正常工作，容易掩盖此问题。

位置：[client.ts:37](/Users/chengjianghao/flowcube/frontend/src/api/client.ts:37)。应使用显式继承当前 API 根地址、带超时的独立续期客户端，保留并发合并并避免递归续期。

### F13 · P1 · 桌面白名单 IP 的证书身份未验证【模拟 + 代码；暴露条件待核验】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

`certificate-error` 对指定主机直接放行，忽略证书内容与错误类型。模拟传入不匹配证书仍被接受。实际影响前提是客户端仍访问该 IP，且网络路径被主动劫持；本次没有核验生产流量目标或开展网络攻击。

位置：[desktop/main.js:388](/Users/chengjianghao/flowcube/desktop/main.js:388)。应使用有效服务器证书，或校验明确自签名部署的证书/公钥身份并设计受控轮换；仅核对目标主机不够。

### F14 · P2 · 桌面实际下载入口遗漏 SHA-256 校验【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

更新清单读取了 sha256，但仪表盘 → preload → 主进程下载入口仅传 URL 和退出安装选项；校验函数仅在收到摘要时执行，因此这条实际路径跳过摘要校验。清单/文件不一致或文件损坏仍会进入后续安装流程。

位置：[desktop/main.js:213](/Users/chengjianghao/flowcube/desktop/main.js:213)、[updateCheck.js:378](/Users/chengjianghao/flowcube/desktop/lib/updateCheck.js:378)。主进程应保存或重新获取可信清单，绑定版本、URL 和摘要，安装前强制校验。该问题与 F13 是不同环节。

### F15 · P2 · 桌面更新发现事件没有前端订阅者【模拟 + 代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

更新检查使用 `ui:'ipc'`；正常窗口下只发送事件，前端没有调用 preload 暴露的订阅方法。模拟发现新版后发送事件 1 次、订阅 0、原生弹窗 0。仪表盘仍有手动下载入口，但自动提示链路缺失。

位置：[desktop/main.js:177](/Users/chengjianghao/flowcube/desktop/main.js:177)、[updateCheck.js:724](/Users/chengjianghao/flowcube/desktop/lib/updateCheck.js:724)、[preload.js:9](/Users/chengjianghao/flowcube/desktop/preload.js:9)。应在应用根部挂载订阅及提示，并在主进程保留待通知结果，避免初始化时丢事件。

### F16 · P1 · 生产部署未等待同一提交的 Tests/Security 通过【代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

Deploy Browser 与 Tests、Security 分别监听 main push；部署工作流没有等待这些工作流的检查步骤。当前提交均成功，但未来测试失败的提交仍可独立进入部署。仓库外的分支保护设置未核验，不能将其当作本部署脚本已有保障。

位置：[deploy-browser.yml:3](/Users/chengjianghao/flowcube/.github/workflows/deploy-browser.yml:3)、[同文件:22](/Users/chengjianghao/flowcube/.github/workflows/deploy-browser.yml:22)。应将部署绑定到同一 SHA 的必要检查成功结果，避免只检查“某次最新运行”。

### F17 · P1 · 部署后健康/页面门禁失败没有统一回滚【代码】

**修复状态：本地已修复，未部署。** 见[本轮修复与验证](system-audit-fixes-2026-09-04.md)。

脚本先替换运行容器，再迁移、健康检查和页面门禁。迁移失败有镜像回退分支；健康检查失败直接退出，页面门禁失败只告警退出，均未恢复旧容器。因此 workflow 失败不意味着线上恢复原版本。

位置：[server-update.sh:105](/Users/chengjianghao/flowcube/scripts/server-update.sh:105)、[同文件:127](/Users/chengjianghao/flowcube/scripts/server-update.sh:127)、[同文件:132](/Users/chengjianghao/flowcube/scripts/server-update.sh:132)。应统一失败处理、验证回退后的服务健康，同时考虑数据库迁移与旧代码兼容性，不能把回退镜像等同于回退数据库。

## 5. 修复前的验证和工程缺口

同日修复：npm audit 失败关闭、显式测试库隔离、Node 22 标签镜像实际执行已完成；生产依赖漏洞重新扫描并升级修复，当前结果见修复报告。

1. **依赖扫描失败被当作通过。** [security-scan.yml:114](/Users/chengjianghao/flowcube/.github/workflows/security-scan.yml:114) 忽略 npm audit 退出码，空结果/解析失败可成功退出；最终计数缺字段或解析异常回退为 0。应区分“无漏洞”和“扫描不可用”，扫描错误不能绿色通过。传递依赖当前只报告、不拦截，也应有单独跟踪机制。本次本地 npm audit 超时，依赖风险结论保留。
2. **测试可能覆盖调用者指定的数据库环境。** [smokeTestKit.js:7](/Users/chengjianghao/flowcube/tests/helpers/smokeTestKit.js:7) 以 `override:true` 加载 `backend/.env`。直接在真实工作区用环境变量指向临时库并不可靠，且测试包含写入/迁移。本次通过不带 `.env` 的提交快照隔离解决。建议测试专用配置并对目标库加入强校验。
3. **CI Node 22 静默跳过标签镜像用例。** 该测试要求 Node ≥23.6；当前 CI 使用 Node 22，所以一个成功的 test:label 不代表镜像一致性被执行。本次另用 Node 26 验证 5 例通过；建议以受支持的 TS 执行方式接回 Node 22 门禁，避免为一个测试强行升级生产运行时。

可维护性方面，后端存在 5 个超过千行的源码文件，前端存在 3 个。销售 service、导出 service、库存 service、标签编辑器和销售表单是后续变更的集中风险区。建议按实际改动逐步拆职责，并围绕跨模块契约补测试；不建议在修复数量和账务问题前开展大规模重构。

## 6. 已有设计中值得保留的部分

- 库存以容器为事实源，出库按任务锁定容器扣减，事务、CAS、幂等键和维度锁已有统一入口；缺陷主要集中在新增 ATP 语义与旧约束衔接、部分数量拆分。
- JWT access/refresh 分工、refresh jti 轮换、账号状态和 token_version 实时检查已有实现；权限问题主要是目标超管账号保护遗漏。
- 退款额度校验和资金出账在同一事务中，采购应付归零已有处理；凭证链路没有完整接住归零和冲销关系变化。
- 前端路由集中登记、懒加载，登出清理查询缓存；PDA 关键操作保留请求键并查询结果，具备断网结果恢复基础。
- 打印使用客户端拉取、单消费者和回执机制，对结果不确定的物理打印保留人工确认，降低重复出纸风险。
- 231 个迁移能在空 MySQL 8 顺利执行，回归覆盖面已具规模，具备持续修复和验证基础。

## 7. 原审计建议的修复顺序与验收标准（已执行）

| 顺序 | 工作范围 | 必须补充的验收 |
|---|---|---|
| 第一批 | F01/F02/F03/F06/F07：数量、报表、超管保护 | 数量守恒；总供应不超配；预占缓存=有效预占；报表已知金额准确；非超管不能重置超管密码 |
| 第二批 | F04/F05/F08/F09：供应与会计生命周期 | 撤回/驳回不悬空承诺；到货/履约释放绑定；来源非零→零正确反冲；红字删除受保护 |
| 第三批 | F11/F12/F13/F14/F15：真实客户端路径 | Android 扫码上架；Windows/PDA 到期续期；拒绝错误证书；损坏安装包拒绝；自动更新提示可达 |
| 下次部署前 | F16/F17 与依赖扫描错误处理 | 同 SHA 检查失败不能部署；健康/页面失败可恢复并验证；扫描失败明确失败 |
| 随后 | F10、测试数据库隔离、标签镜像门禁 | 无审批流给出业务错误；测试目标不可误连；Node 22 实际执行镜像检查 |

修复库存与账务代码后，建议安排**另一次授权的生产只读核对**：检查预占投影差额、退货待检数量守恒、悬空预计绑定、应付与采购凭证勾稽、孤立冲销关联及非超管的重置密码权限。先确定影响范围，再制定修复数据方案；本次未执行生产查询或数据修复。

## 8. 交付、证据与限制

- 本次新增此报告，同步 `AGENTS.md` 风险入口和本地工具文档；业务源代码未修复、未提交、未推送。
- 自动化结果及定向复现输出汇总在 [审计证据 JSON](/Users/chengjianghao/flowcube/docs/system-audit-evidence-2026-09-04.json)，不包含连接密码或业务数据。
- 完整临时日志位于 `/tmp/flowcube-audit-20260904-hr3pqawe/logs/`；临时目录不保证长期保存，关键结果已写入报告及证据 JSON。
- 复现脚本位于 `/tmp/flowcube-atp-memory-repro.cjs`、`/tmp/flowcube-return-qa-memory-repro.cjs`、`/tmp/flowcube-inventory-db-repro.cjs`、`/tmp/flowcube-client-audit-20260904.cjs`、`/tmp/flowcube-finance-audit-20260904.cjs`；数据库脚本只允许独立临时环境。它们不是已提交的回归测试，修复时需要转成正式测试。
- 本次补装 Gitleaks 用于文件秘密扫描；没有新增业务 MCP 或第三方账号授权。
- 验证结束已删除本次临时 MySQL 容器，并停止专用 Colima 虚拟机；保留日志和已安装工具，未停止用户原有开发服务。
- 未核验生产数据、线上负载与慢查询、灾备恢复演练、真实用户权限分配、生产证书或安装包；未进行 Windows/Android 真机、物理打印、完整 UI/可访问性巡检和并发压力测试。
- 依赖漏洞审计因网络超时未完成。上述限制属于后续验证范围，不能据此声称没有问题。
