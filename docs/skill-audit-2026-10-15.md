# 极序开发验收技能盘点与验证（2026-10-15）

本记录是本次文件检查与只读流程演练的证据，不是业务定义或发布验收报告。未来使用时重新核对工作树、规则及代码；本次未操作 GUI 或业务系统、未连接数据库、未启动服务、未运行受阻安全探针。

## 唯一落盘位置与基线

选定 `/Users/chengjianghao/Documents/Codex/2026-10-14/task/flowcube-release-0135`：实际分支 `codex/release-0.13.5-mac-20261014`，HEAD 与本地 `v0.13.5` tag 均为 `710d094e0669d229919c4c20d186121c3f58c7d7`，数量与金额政策比旧主目录完整。这里只核实本地版本身份，没有据此声称当前线上状态。

另一候选 `/Users/chengjianghao/flowcube` 实际在 `codex/frontend-lint-cleanup`，HEAD 为 `a9aeb47543188993c7c3f9253d47eac24df0b476`，既有未提交 `docs/local-tooling-2026-09-04.md`；不在该处写入或同步第二份技能。两处同属一个 Git 仓库的不同工作树，不切换分支、不创建新工作树。

选定工作树检查前已有三项修改（均为新增镜像清理规范）：

| 路径 | 初始未提交 diff | 本任务处理 |
|---|---|---|
| `AGENTS.md` | +1 行 | 保持整文件字节不变；SHA256 `1805573607ebfbdfc82ac8140db5df18859fb0116df5d590c421364eeefa961a` |
| `docs/DEPLOY.md` | +11 行 | 保持整文件字节不变；SHA256 `a16072c8a7545e6e032b08f14f1ba4c2483b668aa49a89edd777bcf1235b69ef` |
| `docs/RELEASE.md` | +2 行 | 保持整文件字节不变；SHA256 `b30352f8f2cfa1070635222e530941b3d04a49c4a91b6f2c5317ae36c6c81811` |

适用上级 `/Users/chengjianghao/AGENTS.md` 要求中文沟通；已读项目根 AGENTS，未发现仓库内更深的 AGENTS。没有新增批准规则、修改全局配置、凭据或权限。

## 现有能力与分工

| 位置/技能 | 实际能力 | 本次选择 |
|---|---|---|
| `.agents/skills/frontend-design` | 通用前端视觉设计 | 原样复用；与个人技能目录同名同内容，不再复制 |
| `.agents/skills/impeccable` | 前端设计、审查、优化等文字流程及 reference；精简手工移植，无 CLI/live/hook | 仅修复 license 的 YAML 引号，正文与许可值保持不变 |
| `.agents/skills/release-flowcube` | 正式发布、版本同步、原包恢复及结果核验 | 原样复用；不新增发布执行技能 |
| `.codex/environments/environment.toml` | 自动生成的开发环境动作，包含 setup、后端、ERP、PDA、代码检查 | 没有项目技能；不修改，不把配置存在当作动作已成功运行 |
| `~/.codex/skills` | 已有 skill-creator、调试、验证、浏览器、工作树等通用技能 | 只读盘点；无需安装或改全局技能。`~/.agents/skills` 不存在 |

两个候选工作树的三个项目技能与 `.codex` 环境文件检查前分别相同。已有 `frontend-design` 与 impeccable 的视觉覆盖重叠保持原状，按实际任务选用；新增技能只协调项目规范与验收，不扩写设计体系。

开发、业务与验收知识已有单一维护入口：[AGENTS](../AGENTS.md)、[验证命令](verification-commands.md)、[全数量与单位](sale-shipping-quantity-policy.md)、[实际金额按分](cash-cents-policy.md)、[库存事务](inventory-transaction-invariants.md)、[业务语义](business-semantics.md)、[前端与 PDA](frontend-pda-conventions.md)、[列表返回](workspace-filter-return.md)、[本地预览](local-preview-acceptance.md)、[打印与运维](print-deploy-ops.md)、[发布](RELEASE.md)和[部署](DEPLOY.md)。协调技能按影响链接它们，不复制数量入口全清单、金额分摊算法、锁序或发布命令。

## 本次三个文件

- 新增 [flowcube-dev-acceptance/SKILL.md](../.agents/skills/flowcube-dev-acceptance/SKILL.md)：42 行协调入口，明确触发范围、先读规则、按影响选测试、状态保留、大数据边界和证据分层；自动发现沿默认行为，没有另加 invocation policy 或全局入口。
- 修改 [impeccable/SKILL.md](../.agents/skills/impeccable/SKILL.md)：license 含 `upstream: https://...`，原未引号值使标准 YAML 报 `mapping values are not allowed here`；仅给完整值加双引号。原文解析失败、单行修正后解析通过，正文逐字节相同。
- 新增本盘点记录：保存位置理由、冲突、只读演练与验证范围。它是时点审计记录，不新增主题政策，也不向已接近体积上限的 AGENTS 追加内容。

## 已发现的不一致及处理

| 来源差异 | 当前依据与本次处理 |
|---|---|
| 旧主目录 AGENTS 仍写“金额/单价/授信四位”、录入统一 fold；发布工作树已区分实际金额与固定销售单位 | 只在发布工作树补技能，引用现行按分、全数量及固定单位政策，不回写旧分支或恢复旧行为 |
| `sale-shipping-quantity-policy.md` 和业务文档某些段落仍称“未提交/未发布” | 该文件已在选定 HEAD 跟踪，本地 v0.13.5 发布说明已列数量政策；旧状态文字不代表今天状态。本次不核线上、不改历史记录 |
| 前端文档 2026-10-08 历史段仍写实际退款四位；业务文档旧普通行例写 `1.005×1=1.00` | 当前 `cash-cents-policy.md`、`cashMoney.productCents`、固定销售 normalize 与 `tests/cash-money.test.js` 的半分用例表明精确四舍五入到分（例为 1.01）。这是源码/测试文本核对，本次未运行该业务测试；不把旧例升级为当前规则，不修改历史金额 |
| 既有 CSS/设计记录存在深色兼容证据；通用视觉技能鼓励主题、动效与鲜明风格探索 | 用户本次明确浅色紧凑且不新增深色主题；协调技能以其为边界。保留现有代码/兼容事实，未删除主题或进行视觉改造 |
| 旧通用列表有界取齐与预占明细新快照续读机制并存 | 按具体页面当前协议选路径；内部 `listMode=paged` 不等于可见页码，不无界取齐或用截断冒充全量 |
| v0.13.5 安装说明明确已知异常历史关联记录权限缺口、两项受阻验证、真机/出纸待验 | 保留这些限制；未运行或改写探针，不将文档校验或其他自动化当作问题已解决，未修改用户批准规则 |

用户已明确的数量、金额、运费和 UI 意图不再要求重决；上述不一致只记录并在协调时指向现行依据。本次没有改业务代码、迁移、历史数据或测试断言。

## 无副作用示例任务演练

已读取新技能并按下列请求逐项推演。仅选择规则、已有检查与所需证据，不发请求或执行业务测试；这是流程桌面演练，不是模型自动触发率测试、GUI 或端到端验收。

| 示例请求 | 选择的流程及验收边界 |
|---|---|
| “极序库存列表返回后保留筛选、滚动和未查询草稿，轮询别清空” | 触发协调技能；读前端与 workspace 文档，选择真实页面受影响组件及 `workspaceListNavigation.test.tsx`、`useWorkspaceSearchParams.test.tsx`。预占大列表另选 `ReservationDetailsDialog.test.tsx`，GUI 需再验证大样本滚动/轮询；当前不操作界面、不宣称流畅 |
| “商品默认不可小数，收货和盘点也要挡住” | 读全数量、业务、库存调用链；选择 `test:qty-precision`、`test:qty-precision-coverage` 及受影响实库入口。先判原始值和未舍入换算量，不把合计整数当逐箱合法；实库只列计划，实例和授权未核实不运行 |
| “三件单价 0.3333 的订单与退货怎么验” | 读按分政策；选择 `tests/cash-money.test.js`、`tests/sale-ordinary-cash.test.js` 及受影响执行链。订单 1.00 与原高精度价格分别验证，分批退货按冻结预算闭合，历史非分事实保留待核；不写业务数据 |
| “把新销售换单位出货去掉，旧单还能看原单位” | 读固定单位及历史边界，选择 `tests/sale-shipping-quantity.test.js`；新销售固定单位、未变旧行原事实分别核验，不扩删采购换算、旧退货或自动重价 |
| “后台显示打印成功，能算出纸验收吗” | 读打印约定，分别要求入队/领取/回执、桌面 RAW 及实体样张证据；回答当前不能据后台状态确认走纸，不触发真实打印 |
| “说一下下次发版流程，先别发” | 复用 release-flowcube、RELEASE、DEPLOY；选择同 SHA 门禁及收尾清单，只读流程，不 bump、不提交、不 push、不打 tag、不清镜像 |
| “给另一个项目改网站配色” | 新技能不触发；留给该项目与视觉技能，不带入极序库存、金额或发布规则 |

已核实表中七个代表测试文件存在；这里只做选择，不运行。未指定具体修复 diff 的示例不能形成最终全量测试清单，实际开发仍按当前脚本、调用链与授权重新确定。

## 验证证据

- 运行环境 Node `v22.23.2`；按项目要求加载本机开发环境后运行纯静态 `node tests/agents-md-injection-guard.test.js`，exit 0：30 个 docs 引用、32 个 npm 脚本引用、31451/32768 字节、失败 0。
- 使用系统 `/usr/bin/python3` 的既有 PyYAML 6.0.3 运行技能创建指南自带 `quick_validate.py`；新技能及修正后的 impeccable 通过，原 frontend-design 与 release-flowcube 也通过。默认 PATH 的另一 Python 缺 PyYAML，改用已安装的系统解释器，没有安装包或修改全局环境。
- 新技能 19 个链接指向 17 个独立本地目标，逐一按实际落盘路径解析且都在同一工作树内；核对代表测试路径和 root package 脚本存在，未运行它们。
- `git diff --check` 及新增文件尾空格/末尾换行检查通过；新 name/description 有效，无未完成模板。唯一名称与项目原三技能不同，未加重复业务事实文档或执行脚本。
- 落盘前后复核原三份未提交文件完整 SHA256、原两技能及 `.codex` 环境文件，保持不变；impeccable 仅许可行加引号。旧主目录状态与其本地工具文档 SHA256 保持不变。HEAD 不变，索引未暂存；本任务仅三个明确路径。

## 调用及尚未验证

从选定项目根目录启动新会话，使用 `$flowcube-dev-acceptance`，例如：“用 $flowcube-dev-acceptance 先列出这次收货页修改的规则与验收计划，暂不运行业务测试”。若名称尚未被新会话发现，直接指定 `.agents/skills/flowcube-dev-acceptance/SKILL.md` 供读取；不复制到另一工作树或全局目录绕过加载。文件已验证不代表当前会话热加载或自动选中行为已实测。

没有提交、推送、发版、生产访问、数据库/API 写入、GUI、Windows/PDA 真机或实际出纸验收；未运行此前受阻探针、全量业务测试或构建。临时草稿和校验基线仅放 `/tmp/flowcube-skill-20261015/` 与 `/tmp/flowcube-skill-baseline-20261015.json`，不是第二个项目安装位置。

本次技能交付没有待定的业务规则。后续可另定历史文档状态/旧例的整理范围、已知权限缺口修复范围及设备/打印现场验收安排。将技能带到后续开发分支应走正常审阅与合并；本次不代为提交或合并。


## 2026-10-17 最小格式修复补记（未提交、未发布）

后续只同步 `.claude/skills/impeccable/SKILL.md` 的原 license 引号，许可值与正文不变，使标准 YAML 可解析；`.agents` 的同项此前已修。本次不覆盖技能目录，不改 AGENTS/审批权限/发布策略。新增 `flowcube-dev-acceptance` 及 `.agents` 四技能、Claude 侧四项专项技能均保留；两份 release-flowcube 的 `.agents`/`.claude` 脚本路径是各自有效引用，不强行全文统一。跨平台真源、生成头与差异白名单仍另行决策，不建立自动复制流程。

同时修正两个既有测试 lint：`audit-deployment.test.js` 的两个正则空格改为等价 `{2}`；`deployment-resources.test.js` 的同步无提前 return 回调改为显式捕获原异常、执行原清理，再在清理成功后重抛原异常。原有“清理失败优先、ESRCH 忽略、否则原失败重抛”顺序保持；不加 ignore、不隐藏 throw、不删测试或放松断言。实际测试回调的纯 VM 对照覆盖主错误/清理错误/双错误及 falsy 抛值、匹配/不匹配文本，并运行受影响的既有 fake 边界测试；这不等于部署、真实数据库、通知或 GUI 验收。具体候选、原路径命令和独立审阅证据保存在当次核验目录，不改写此前已封存的红灯/限制记录。
