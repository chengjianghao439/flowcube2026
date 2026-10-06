# Security Cloud 27 项整改记录（2026-10-06）

本批在隔离分支 `codex/security-scan-remediation` 完成 27 项的本地代码整改、独立复审及受影响回归。交付状态为本地分支；未推送、合并、发版或改动生产，未在 Security Cloud 将问题标记为已解决。发布链路的真实 GitHub runner、安装包、代理配置和现场设备证据仍需正式交付时补齐。

来源：仓库 `chengjianghao439/flowcube2026`，扫描 `wfr_7f6149fd10e3a50155dcabedc99158510d347b4a3de25d31ae852129df58b533`，扫描及整改基线 `14e97aa9dc9df0700b394d59cafbc53dba0c5e69`。已读取全部发现详情，合计 5 High、12 Medium、10 Low。下表编号对应原扫描数组顺序；原始报告保存于本地忽略目录 `output/security-scan-2026-10-06/findings.json`。扫描发现的静态攻击路径不等于生产已遭攻击。

## 逐项结果

所有行的实现状态均为本地已整改。证据列区分真实 HTTP/MySQL、离线运行与工作流契约，不能相互替代。

| # | 严重性及问题 | 核心修复 | 本轮证据 |
|---|---|---|---|
| 1 | High：双代理合并公网限流身份 | Caddy 覆盖 XFF，后端限制可信代理地址与跳数，统一使用 req.ip | Express 真 HTTP 的双客户端及伪造头反例；实际生产 Caddy 待应用 |
| 2 | High：PDA 退货队列、收货及质检越仓 | 用户范围与非空设备仓同查；先锁任务并授权再回放 | 原基线反例及真实 HTTP/MySQL |
| 3 | High：任意 PDA checkout 接触签名/生产凭据 | 受信主线 SHA；无密钥构建、独立 runner 签名和发布；来源清单逐次复核 | 临时 Git、产物字节及 workflow 契约；实际签名 CI 待验 |
| 4 | High：匿名及超额写请求先耗业务日志连接 | 限流先于解析；认证后才挂业务日志；公开登录/退出仅用可信 actor | 真 HTTP 验证匿名/超额业务日志零写，合法写的预写失败仍阻断 |
| 5 | High：桌面任意 checkout 在发布凭据出现前执行 | 受信 SHA；只读构建、fresh 发布 job；精确 artifact ID 和来源核对 | 临时 Git、manifest、工作流及中转回归；真实桌面 CI 待验 |
| 6 | Medium：公开打印机标识充当工作站认证 | 随机可撤销凭据，claim/ack 绑定凭据；Electron 安全存储与桥接 | 真 HTTP/MySQL 凭据专项及客户端组件回归；安装后现场待验 |
| 7 | Medium：报销审批泄露他人单据 | 申请人或当前角色 view.all 授权，读取审批前检查 | 离线反例及真实 HTTP/MySQL |
| 8 | Medium：任务包裹列表/条码越仓 | 拥有任务仓授权先于商品及打印查询 | 离线反例及真实 HTTP/MySQL |
| 9 | Medium：API 在限流前解析大请求 | 入场限流/并发先行；仅 API 解析；字节、结构及参数预算 | 真 HTTP 顺序、精确边界和拒绝反例 |
| 10 | Medium：旧 refresh 重放不能撤销后继 | 轮换共用会话族；撤销持久化后才报 replay，记录安全审计 | JWT/bcrypt 回归及真实并发 HTTP/MySQL |
| 11 | Medium：盘点不核 PDA 绑定仓 | 用户范围与设备仓检查先于旧回执，合法终态回执保持 | 离线反例及真实 HTTP/MySQL |
| 12 | Medium：全局搜索绕过模块权限/归属/账套 | 每类沿用 canonical view 权限，报销本人、发票账套、销售明细仓过滤 | 离线反例及真实 HTTP/MySQL |
| 13 | Medium：导入 ZIP/解析内存无界 | 解压/行列/字符串预算，受限子进程、超时与两级并发收尾 | 真实解析子进程、炸弹与精确边界；原客户/供应商导入真实 DB |
| 14 | Medium：打印管理与统计越仓 | 管理、更新、绑定、客户端统计及队列统一仓范围 | 真 HTTP/MySQL 两仓凭据专项；三类条码真实查询 |
| 15 | Medium：打印份数放大无界 | 份数与 UTF-8 总量在展开前检查；服务端/Electron/renderer 同限 | 真实函数预算及字节边界；大正文列表仅读取 metadata |
| 16 | Medium：多个列表 pageSize 无界 | 校验整数、有限数及安全 offset，再用共享有界分页 | 真实 service SQL 桩；打印队列 HTTP 回归 |
| 17 | Medium：对账报表/导出丢仓范围 | 来源单据授权共用于汇总/明细/计数；分页导出保留 scope 与筛选 | 离线反例及真实 HTTP/MySQL，空范围为空 |
| 18 | Low：Unix 临时打印文件可预测 | 私有随机目录、exclusive 文件及 finally 清理 | 真实临时文件和失败清理反例；CUPS 出纸待验 |
| 19 | Low：Gitleaks 浮动镜像及过大能力 | digest、只读源、独立输出、无网络/token/cap；license 与 fallback 互斥 | 工作流反向契约及官方 registry digest 核对 |
| 20 | Low：禁用账号登录可被枚举 | 失败响应统一；所有路径一次 cost-10 bcrypt，锁后再核签发条件 | 三类失败请求一致，专用审计保留 |
| 21 | Low：NSIS 下载未经摘要核对 | 固定官方摘要，解包前强校验 | 锁定官方 toolset 摘要交叉核对及真实 helper 篡改拒绝；本机归档下载超时 |
| 22 | Low：退出后 access 继续有效 | 当前会话族即时撤销，轮换/清理祖先也能安全退出 | 真实 refresh/logout 并发与其他设备仍有效 |
| 23 | Low：重新启用恢复旧 token | 禁用同事务递增版本并撤销族/JTI，启用不恢复 | 真实 HTTP/MySQL 禁用/启用及旧票据拒绝 |
| 24 | Low：文档模板布局/数据可放大 | 元素、列、行、单元格、字符串预算；raw ZPL 替换前核 UTF-8 | 布局与 raw 放大红绿、精确字节边界、旧模板回归 |
| 25 | Low：生产第三方基础镜像浮动 | 官方 manifest digest 固定；镜像 SBOM/来源记录绑定本 SHA/run/字节 | registry 原始字节核对及 CLI/来源契约；本机 Docker DNS 阻断真实 Syft，待 CI |
| 26 | Low：Gradle 分发未经校验 | wrapper 固定官方 SHA256 | 官方校验文件及真实 wrapper 错误 ZIP 拒绝；完整 Android 构建待 CI |
| 27 | Low：PDA 建包能操作他仓任务 | 非空绑定设备仓必须匹配任务仓，创建前授权 | 原基线反例及真实 HTTP/MySQL |

## 验证与复审

使用 Node 22.23.2，独立新建测试库 `flowcube_security20261006_4ffbe743_test`，仅回环 127.0.0.1:3307。完整 277 项迁移自然退出 0；新增 276/277 原 SQL 重放两次，并以 information_schema 核对实际类型、空值属性和索引列序。未修改开发库/生产库，也未使用含全表清理的 repair 套件。合成业务夹具保留供审计，资源清理按本轮精确 ID 执行。

三个授权子任务交叉进行 spec 与质量复审；追加修正包括轮换/已清理祖先退出、解析进程启动失败收尾、打印 401 不误登出 ERP、大正文队列只查 metadata、raw ZPL 预先核预算及发布产物 metadata 传输兼容性。各组最终复审未留已知必修项。新守卫有原基线或缺陷注入的自然失败证据，随后修复自然通过；被终止/环境失败运行没有计为通过。

本轮通过的范围包括新安全离线与数据库专项，后端 lint，前端 lint/类型与 ERP、PDA Web 构建，前端单测、权限/路由/SQL/部署资源门禁及受影响打印、发布工具回归。真实数据库扩展验收已通过主链路 49、仓范围 43、PDA 设备 28、并发守卫 123、打印队列 14、模板预览 30 场景，以及认证、导入和打印凭据专项。全前端单测的一次完整运行 196 文件/1230 测试通过；之后只补跑受影响客户端测试。最终批次的准确结果写在下方执行记录，不能把不同运行的用例数相加当覆盖率。

主题记录：[入口与供应链](security-release-remediation-2026-10-06.md)、[资源权限](security-scope-remediation-2026-10-06.md)、[会话与导入](security-session-import-remediation-2026-10-06.md)、[打印](security-print-remediation-2026-10-06.md)。新入口及测试环境说明见 `verification-commands.md`。

## 交付及后续验收边界

正式合入前仍须核对迁移编号：本分支新增 276/277 只相对于基线最大 275；另一未合入 go-live 工作树也有后续编号，不代表可直接合并。未改另一工作树的迁移或业务设计。

正式上线时需对最终交付 SHA 跑项目要求的全量套件和远端 Tests；核平台 main/Environment 保护、两端构建签名与真实 artifact 中转、Docker 实际 SBOM、安装后 Electron safeStorage/WinSpool/CUPS、PDA 真机、物理出纸，并按新模板明确更新宿主 Caddy 配置及验证双代理。会话族上线会使无 familyId 的旧票据要求重新登录；旧打印工作站需重新登记随机凭据。这些升级行为须纳入发版说明。

来源清单是本 run 的摘要记录，未声称 GitHub/OIDC 签名证明。打印机全局 NULL 仓归属对限仓账号保持拒绝；是否新增全局打印机业务授权是另一个业务决策。本轮未开展新功能、现场验收或生产操作。

## 最终执行记录

2026-10-06 最终批次全部自然退出 0，无 skip/cancel：安全离线 102/102；数据库复合专项含迁移、范围、会话 3/3 与打印凭据 11 场景；受影响前端 3 文件/42 测试；部署资源与 artifact 40/40；发布工具 21/21；打印规则 17；权限 7/7。后端 lint、前端 lint（0 error / 33 warning）、tsconfig.app 类型、ERP Web 构建通过；PDA Web 构建亦在最后客户端修改后通过。SQL 标识符、查询循环、路由权限、API 路由、AGENTS 体积/引用、actionlint（显式禁 shellcheck 子检查）、新增 SBOM shellcheck 和 diff 检查通过。未宣称默认 actionlint 所含全部 shellcheck 告警已清零。

最后打印查询改动后的真实数据库复跑：打印队列 14、模板预览 30、并发守卫 123 场景通过。最终日志分别位于 `/tmp/flowcube-security-final-offline.log`、`/tmp/flowcube-security-final-all-security-db.log`、`/tmp/flowcube-security-final-frontend-*.log`、`/tmp/flowcube-security-final-contract-*.log`、`/tmp/flowcube-security-verified-smoke-*.log`；临时路径只定位本轮证据，不是可移植运行环境。

本地提交范围为本批入口、权限、会话/导入、打印、供应链实现，相关迁移、守卫、CI 与主题文档；完整逐路径清单见 `security-scan-remediation-paths-2026-10-06.txt`。提交结果以该隔离分支的 Git 历史为准，不含忽略目录、依赖、真实配置或生产数据。main 仍为基线 SHA，原用户未跟踪文档及其他工作树保留。
