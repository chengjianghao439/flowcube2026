# v0.12.0 发布结果（2026-10-03）

**状态：2026-10-04 用户在获知 PDA 内核限制后再次明确要求“发布新版本”，本轮按此前延后现场设备验收的安排继续正式发布；当前尚未完成发布。** 本地依赖、样式及独立审查已通过，代表电脑业务页已复验。PDA设备内核仍未核实：新版样式要求 WebView/Chrome111及以上，现有配置最低60；本次发布授权不构成旧设备兼容证明。

首轮应用目标 SHA：`02446403a9f86470642115b432bcffb766417fea`；版本 0.12.0，PDA versionCode 150。三端 package/lock、Android 与 PDA 清单、用户更新说明和官网摘要同批提交；主线由此前独立验收工作树快进整合，不纳入主目录未跟踪文档或 Claude 工作树变化。

本批为成套配件、边收货边上架、销售价格与单位解释、跨岗位入口、塑料盒/套单/退货原操作恢复、财务只读来源/往来衔接、物流打印说明及并发授信收口。不含已排除的到货建单/采购跟进，也不含复制开单/银行导入或产品化。

发布前本地系统验收见 `docs/superpowers/plans/2026-10-03-system-acceptance.md`，代码基线79a3c54；之后文档与版本说明变动已经审阅，官网摘要/部署资源26项/文档门禁与摘要lint通过。准备阶段曾用不存在的npm别名及错误cwd调用校验，改为实际守卫路径后通过；独立调用中转预检时缺入口提供的GitHub环境，补完整上下文后通过，均发生推送前，没有生产写入。

正式入口 `npm run release:prod`，使用既有本机HTTP代理、`flowcube-prod` SSH及本地自动artifact中转。预检确认四项页面验收Secrets名称具备、CI可信主机键匹配。推送前仅查询生产schema元数据，idx_order_id精确为单列order_id，迁移尾268；未读取客户/账款数据、原始生产环境或配置口令。

首轮入口退出1，未创建 v0.12.0 tag、未切换线上应用或执行本批生产迁移。后续修补仅在本地发布分支。Android/Windows真实安装、硬件扫码、实际出纸、官方物流和员工试用仍未验证；这些不因本次线上下载验证自动完成。


## 首轮同 SHA 工作流及失败位置

| 工作流 | Run ID | 结果 |
| --- | --- | --- |
| Tests | 37128677358 | success（19 个 job 全部通过） |
| Security Scan | 37128677421 | failure：desktop npm audit；其余 audit matrix 被取消，不能写通过；敏感文件与 Gitleaks 通过 |
| Deploy Browser App | 37128677418 | failure：等待同 SHA Security Scan 门禁；未进入构建/生产切换 |
| Build PDA APK | 37128677367 | APK 构建通过，等待浏览器门禁失败，发布 job 未执行 |
| Build Desktop Installer（main 验证） | 37128677501 | success；只是验证构建，不是 tag 发布 |

五组来源均为完整应用目标 SHA，原失败不删除、不改写为恢复成功。正式入口首轮启动时间保留 `/tmp/flowcube-v0120-release-start.txt`，完整日志 `/tmp/flowcube-v0120-release.log`；中转随入口退出已停止，未改走手工跳过门禁的交付。线上公开桌面清单 0.11.5、PDA 0.11.5/149、健康接口正常；生产后端包版本仍0.11.5。公开remote tag查询无v0.12.0。

## 中间修补候选及撤回记录（已由后续候选替代）

- backend：Multer 2.3.0→2.4.0、brace-expansion 各系列兼容补丁。开发命令改用既有 Node22 的 `node --watch index.js`，移除仅用于热重启的 nodemon/chokidar/braces；生产 `start` 及业务代码不改。
- frontend：Axios 1.19.0→1.20.0、brace-expansion 兼容补丁；Tailwind仍3.4.19，尚未变更样式构建方式或组件。
- desktop：仅保留 brace-expansion、fast-uri 兼容补丁；保持 Electron44.3.0、electron-builder26.15.3 与原 get3 下载链。曾试用 get5 override，但独立审查证实旧打包器传入的 got 超时/代理参数不被 Fetch 正确转换，503 响应也不再按原 statusCode 逻辑重试，已撤回该候选；不采用 audit 建议的旧 builder26.5.0，也不修改安全门禁。

backend/frontend 按新 lock 安装自然0。四份完整 audit JSON 本机留证：backend/scripts-browser-smoke exit0且0漏洞；frontend仍exit1、5项high（同一braces来源沿Tailwind/chokidar/fast-glob/micromatch传播）。desktop撤回后重新audit exit1、8项high（get/got/cacheable-request/http-cache-semantics及打包器传播），证据`/tmp/flowcube-v0120-desktop-audit-withdrawn.json`；此前get5候选audit0仅是被拒绝方案的中间结果，不能代表最终候选安全。`npm audit fix --package-lock-only` 三项原exit1也保留，未误称修补命令都成功。

保留补丁验证：真实HTTP上传限额/字段测试6项通过，桌面更新与部署资源35项通过；Axios五文件63项通过，后续完整195文件1226项通过，app类型与ERP/PDA前端构建自然0。Node原生watch用实际dev命令与合成依赖文件变化证明能自动重启，自有进程组关闭。上述桌面35项证明现有更新/资源契约，不证明新Windows正式构建或安全门禁通过。

被撤回方案的探针单独留证：get5曾通过官方NSIS3.0.4.1与7zip的固定摘要下载/提取，但独立实际app-builder-lib 503探针仅fetch一次、没有超时signal（旧600000ms配置未转换），HTTPError.response.status存在而旧statusCode不存在；get5代理还需显式initializeProxy或ELECTRON_GET_USE_PROXY，单有HTTP(S)_PROXY不足。这些已证实的兼容回归决定撤回，成功路径不能抵消失败路径。早期探针读取未导出的package元数据、把返回对象误当字符串属探针设置错误，修正后下载成功；没有改下载器、摘要断言或NSIS版本。自有下载缓存已删除，未在本机生成正式EXE。

## 首轮修补后的取舍记录（以下为当时状态）

剩余两条阻断：桌面旧缓存链的 http-cache-semantics4.2.0 无修复版，强制 get5 升级已有兼容回归；样式链的 braces3.0.3 尚无修复版（官方公告2026-10-02更新）；Tailwind3.4.19仍依赖该链。不能为通过audit强行忽略开发依赖、改报告或无依据替换版本。用户已批准在本地调整样式构建链，保留现有React页面、业务流程、主题与单位/财务政策，先验证样式与运行平台兼容，再重新发布同版本的全新应用提交（本版尚无正式包可覆盖）。

若采用官方Tailwind4.3升级，需要按官方指南处理PostCSS/Vite接点、配置加载、边框/阴影/焦点/动画差异与content扫描；现有Tailwind3配置不能假定直接生效。它的最低浏览器要求也改变（Chrome111+/Safari16.4+/Firefox128+），需核PDA WebView及桌面Chromium，不能在无真机条件下宣称所有旧设备兼容。升级尚未实施，进入已授权的兼容调整阶段；也可选择保留修补候选、等两条依赖链官方兼容补丁后发布。桌面需获得兼容的稳定打包器/下载器方案，并重新验证超时、503重试及代理行为；不以简单override或关闭audit替代。

后续验收：四端依赖安全门禁完整通过；自动单测/类型/构建；实际浏览器核登录、销售开单与套件、仓库PDA页面、财务弹窗及深浅主题；确认最低平台边界；重新对同一应用SHA运行Tests/Security/Browser/PDA/桌面验证，然后tag正式包与三端下载摘要。首轮失败时未发布的artifact不得拿来代表新候选；成功结果再另补总耗时、完整SHA/版本码/runID/镜像revision/迁移及资源收尾。

资料（官方源，查询2026-10-03）：[braces 无补丁公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[http-cache-semantics 无补丁公告](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)、[brace-expansion补丁](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)、[get5移除got改用Fetch](https://github.com/electron/get/releases/tag/v5.0.0)、[Tailwind官方升级与平台要求](https://tailwindcss.com/docs/upgrade-guide)。


## 已授权的第二轮构建依赖调整（本地，尚未推送）

用户答复“先调整构建依赖并验证，再发布”后实施，计划见 `docs/superpowers/plans/2026-10-03-release-build-dependencies.md`。这不改变原业务代码、库存/财务政策、Electron44.3.0、builder26.15.3 或 NSIS3.0.4.1。

桌面保留稳定 builder，固定 get5.1.0 和 Undici7.29.1；通过官方 Downloader 接点注入兼容适配。只在安装时改一处 `configWithProgress`：原文件 SHA256 `3452ca5b9a2f29dd6460f0cc9937be2dc1bbbf36809f410649a015b35a607b48`，补后 `7c298a076e5deed41bc395bf96f749d2755b6d8b8dce33d40d905ed438babaad`；版本、摘要、安装布局漂移均拒绝。不是此前已撤回的裸 override。每次请求独立超时，保留503/网络重试分类、外部取消原原因、TLS与摘要校验；显式 HTTP/HTTPS 代理按每次重定向实际协议选择，用私有 dispatcher 并 finally 销毁，不污染全局。

桌面真实专项18/18自然通过，根独立复验 `/tmp/flowcube-v0120-builder-final-root.log`；最低 Node22.12.0 实际运行18项通过，主环境22.23.2。独立质量审查曾发现 HTTP-only 代理会被错误用于 HTTPS，真实交叉协议红→补正后18项绿且复审 ACCEPT。原始红、交叉协议红及正常日志保留。这些均不是 Windows EXE 或真实安装验收。当前适配器通过实际 `getMakeNsisPath(null)` 下载官方 NSIS/7zip、核固定 NSIS SHA256 `9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa` 并提取编译器；专属新缓存精确删除，证据 `/tmp/flowcube-v0120-builder-current-nsis.log`。当前 `signExecutable=false` 的流程覆盖；未来签名证书下载旁路仍须另做评估。稳定上游兼容版本可替代时应删此窄补丁。

样式改为官方 Tailwind4.3.3/PostCSS 接点并显式加载原配置；保留现有颜色、字体、深浅主题、圆角、旧阴影/模糊尺度及原语义类。旧 palette 242 色值冻结为 `tailwind-v3-colors.js`；merge3.6.0 配合新引擎。未改销售/PDA/财务业务页面。基本896项真实浏览器计算样式对比0差异，但独立审查新增的隐藏首项 spacing 与窄汇总 divider 原有差异，已修复并扩至2070项持久验收，另补响应式divide-y-0及真实focus发现的outline顺序差异；不能把基本896项绿写成所有布局已验证。新旧实际 ERP 登录页及 PDA 登录页在相同 viewport/主题下肉眼核对；PDA 绑定请求被未绑定设备重定向到登录，所以未声称体验过绑定页。预览刻意无后端，不据此证明登录、销售或财务业务流程成功。

四份最终完整 `npm audit --json` 自然 exit0，info/low/moderate/high/critical 全部0：`/tmp/flowcube-v0120-final-{backend,frontend,desktop,scripts-browser-smoke}-audit.json`，每份相邻 `.exit` 保存0。没有降低 severity、略过开发依赖或关闭门禁。前端迁移后195文件1226项、app类型、lint（0错误/33既有警告）、ERP/PDA前端构建已通过；2070项修前39差异自然exit1（34间距/分隔、5轮廓），修后自然exit0/0差异，另独立规格运行同样通过；日志 `/tmp/flowcube-v0120-style-edges-red.log` 与 `/tmp/flowcube-v0120-style-compat-final-green.log`。新增黄金值由原checkout的3.4.19/merge2.6.1/原控件和CSS生成，原896逐项保留；独立SPEC/QUALITY已ACCEPT现用/fixture覆盖范围；SPEC另用原v3 CSS/旧merge独立重采896项逐项精确一致，`/tmp/flowcube-v0120-style-spec-v3-independent-final.json`。真实桌面mouse hover、键盘focus-visible、Dialog开关以及现代Chromium pointerType=touch回调通过，后者hoverCapability实际true，不当PDA真机或触摸设备hover:none验收。最终样式验收已跨到北京时间2026-10-04，首轮10-03起点保持。原23条 jsdom 请求噪声保留，不能称日志全无错误。

### 未完成的发布条件

PDA 仍未提供可核实的 WebView 版本：Capacitor 未显式提高 `minWebViewVersion`，默认60，而 Tailwind4 官方最低 Chrome111。Android 版本或桌面 Chromium不能代替设备内核证据；已请求设备信息，等待答复。本地候选不能据此直接更新生产 PDA。独立样式及整批依赖质量审查已ACCEPT；代表电脑业务页已复验，随后逐路径审查/提交本地候选；受影响CSS补正后的lint（0错误/33警告）、app类型、ERP/PDA前端构建已通过，分别 `/tmp/flowcube-v0120-final-frontend-lint.log`、`-final-types.log`、`-final-build.log`、`-final-build-pda.log`；确认平台后才能重新经唯一入口发布。新 SHA 的远端 Security/Tests/Browser/PDA/桌面及 tag 发布、EXE/APK真实摘要、线上镜像/迁移均尚未验证。

资源：用于新旧登录样式的自有 `flowcube-v0120-pages` 会话已关闭并复查不在列表；新旧 Vite预览的已知工具会话38628/99803已退出0，未关闭用户浏览器/代理/数据库。独立样式任务与SPEC的自有会话已关闭并确认退出。代表业务整页自有浏览器/backend/pool/Vite亦已收尾，精确56426/5186及前一轮5187无监听，最终自有会话列表为空。首轮入口开始时间及失败日志继续保留，不换起点隐藏修复耗时。

2026-10-04 独立 QUALITY 另用原Tailwind3.4.19/merge2.6.1、原CSS/config和六个共享控件重新采集全部2070项，与冻结golden逐项精确一致；242个冻结色值也一致，日志 `/tmp/flowcube-v0120-quality-v3-independent-capture.log` 与 `-quality-v3-independent-golden.json`。当前新样式独立自然exit0，桌面18项另独立复跑自然exit0，均无代码BLOCK。该ACCEPT限现代Chromium、现用fixture样式与当前禁签桌面下载链，不解除PDA平台确认或生产门禁。


## 2026-10-04 代表真实业务页复验与本地检查点

实际连原本任务合成测试库 `flowcube_product20261001_fdb108_test`（127.0.0.1:3307），核账号active、真实登录与数据库身份后，只读查看当前候选源码。成套/混合成交明细、普通销售单、库存总览及查询弹窗、月结账款/对账列表与明细弹窗，共18张浅深截图实际观察，无明显布局异常；观测的1512px整页外溢及弹窗越界均0。对账明细→来源销售单→回月结标签自然成功，关闭后body.pointerEvents=auto、Dialog数量0。HTTP日志仅有登录非GET，未调用库存/财务写接口；不宣称数据库所有行都未变化（登录会话等另计）。深色为显式.dark CSS观察状态，非产品主题切换流程。批次拣货只验证空态；PDA仓库页、往来页未补验，不当代表页已经完整全覆盖。

报告 `/tmp/flowcube-v0120-business-pages-report.json`，逐状态 `/tmp/flowcube-v0120-business-pages-results.jsonl`，截图同前缀 `-business-<页面>-<light/dark>.png`。以上是本机本轮证据，不是永久归档或生产数据。命名浏览器关闭确认；server/pool自然exit0、Vite受控停exit143、owner自然exit0，56426/5186无监听。删除本任务认证档案命令一次漏传--session创建default守护进程，经创建时间/命令归属证实后精确关闭，最终session list空；未关闭其他任务资源。

最终依赖/兼容代码、两组回归与CI接线、对应说明/验收记录共25个明确路径，在 `codex/release-v0.12.0` 保存本地待发布检查点；不快进或推送main，不打tag/生产部署。首轮main仍0244640。提交内容不包含原主目录未跟踪计划或Claude工作树内容。PDA内核资料仍未答复；确认支持后还须合法绑定的PDA代表页、同新SHA远端全部门禁、正式原生包及生产三端核验。用户更新说明及目标0.12.0/150不变，本版没有旧正式包可复用。

## 2026-10-04 再次发布授权与验收边界

用户在上一轮说明尚未发布及 PDA WebView111最低要求后，再次明确要求“发布新版本”。沿用用户此前“设备不在身边，先完成可自动验收部分”的安排，推进正式发布及线上系统核验，不再等待设备现场验收。此前“保留本地候选”的发布安排由本次指令更新；不把未答复的设备问题当成设备兼容已确认。代码候选为96d5cdb，新增本段仅记录发布范围和授权边界；完整发布目标SHA以本轮入口为准。现场PDA安装/内核/扫码、Windows更新弹窗、实际打印和员工试用继续明确待验。
