# v0.12.0 发布结果（2026-10-03）

**状态：失败后修补并恢复发布完成。2026-10-04，浏览器、桌面与 PDA 均为 v0.12.0，PDA versionCode150；应用/tag/线上镜像 SHA 均为14e97aa9dc9df0700b394d59cafbc53dba0c5e69。** 同SHA全部CI、tag桌面正式发布及独立线上12/12核验通过。PDA实际设备内核仍未确认，新版样式要求WebView/Chrome111及以上；Windows真实更新弹窗、PDA安装扫码、实际出纸与员工试用仍待验。下面首轮/中间候选的“未发布”只记录当时状态，最终结果见文末。

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

## 第二轮正式入口：f88d801（已失败，未部署）

2026-10-04 01:00:20 北京时间再次启动。首次启动缺工作树本机部署配置，发生push前；改为让正式入口内部读取主目录既有私有配置路径，不将内容输出或复制入仓库。正式目标f88d80142d6a4dd805caaef03a5f6d91aa57c631。

Security37138930020全部六job success；Tests37138930057的20job中19成功，唯页面夹具样式脚本失败；桌面main验证37138929898 success。浏览器37138929928因Tests拒绝；PDA37138930014原生构建success、等待浏览器失败、publish skipped。未tag，未生产切换或迁移。正式入口exit1，中转及caffeinate结束。

样式失败在真实鼠标悬停能力断言，不是2070个属性比较已报差异。进一步将本机Chromium primaryHoverType设置为0，重现真实元素:hover=true而matchMedia('(hover: hover)')=false；日志`/tmp/flowcube-v0120-ci-hover-red2.log`自然exit1。裸环境变量启动参数探针发生空页超时（具体原因未核），属于无效重现，保留`-ci-hover-red.log`，不当作同一失败证据。脚本在初次启动显式设primaryHoverType=2，与[Playwright官方Chromium启动机制](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts)一致；agent-browser0.36官方启动源码没有该desktop设置。保留真实mouse动作和元素:hover、媒体能力双断言、原2070 golden，不改产品CSS或刷新基线。新日志`/tmp/flowcube-v0120-ci-hover-green.log`自然exit0，2070项0差异、键盘focus/Dialog/现代touch均通过，自有会话退出确认。Linux输入能力差异是依据官方实现与同症状重现的判断，须由新SHA CI再次验证。

## 第三轮最终发布与独立复核（成功）

最终应用SHA：`14e97aa9dc9df0700b394d59cafbc53dba0c5e69`；正式tag `v0.12.0`指向同SHA，origin/main同SHA。业务基线79a3c54，依赖/视觉修补96d5cdb，重新发布指令记录f88d801，本轮仅再修测试的desktop输入能力前提，未改产品CSS或业务规则。下表六个工作流全部success；Tests20个job、安全6个job均通过，新增2070项旧样式比较/真实hover/键盘focus/Dialog/现代touch在Linux CI通过，桌面18项真实下载专项通过。

| 工作流 | Run ID | 结果 |
| --- | --- | --- |
| Tests | 37139541992 | success |
| Security Scan | 37139541954 | success |
| Deploy Browser App | 37139541962 | success |
| Build PDA APK | 37139542079 | success |
| Build Desktop Installer（main验证） | 37139541940 | success |
| Build Desktop Installer（v0.12.0正式发布） | 37141018583 | success |

正式入口`npm run release:prod`自然exit0；自动验证12/12及中转接收者确认通过。Root另独立执行`npm run release:verify -- --origin https://jixuflow.com`自然exit0、12/12，两次都实际流式下载EXE/APK核摘要，而非只看清单。独立完成时间2026-10-04 01:45:21北京时间。公开latest.json/桌面更新API0.12.0，PDA0.12.0/150 available=true，健康ok。GitHub Release为正式非草稿非预发布，发布时间2026-10-04 01:44:07北京时间，附件摘要与官网原包相同。来源：[正式Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.12.0)。

| 原包 | 字节数 | SHA256 |
| --- | --- | --- |
| Windows EXE | 112466141 | a9204f5b369e94dc0b58214744733d651a9a547af97c22ae09b94b2b7cc6b20a |
| PDA APK | 15136173 | b8a5262871913ed3edfbd2da7b37b9fb3cffaf11c56f91d1a43b0a99927ccd06 |
| 镜像归档tar.gz | 205206460 | b8027dc1f37f447d0ea359cca02e1e0e1ece70c0a62683835ffc207faa3be4b5 |

独立生产只读核对：backend/frontend现运行容器的OCI revision均为最终完整SHA；db_migrations的269–275七条已执行。information_schema按名称/列序核20个索引、21个保留外键，且272明确删除的fk_sale_refund_order不存在；basis_origin为nullable varchar(30)，与迁移最终状态一致。初版临时核对脚本只汇总ADD语句而未计272的DROP，曾将该外键缺失误报为一项不符；核实完整迁移后修正期望重验0差异，没有修改生产结构。只查询元数据，未获取真实客户或账款明细。证据`/tmp/flowcube-v0120-production-schema-report.json`；部署日志另证明迁移、健康与生产页面及对账来源跳转门禁通过。

三个原始Actions artifact均自动本机中转，未手工复制或重新构建：PDA下载306.4s/上传3.8s；镜像下载565.2s/上传36.8s；桌面下载389.0s/上传20.7s。ZIP摘要、唯一成员、原包大小/摘要与服务器接收校验保留；慢分段通过既有256KiB细分恢复。依赖操作端既有127.0.0.1:7897代理、Mac在线及flowcube-prod SSH，不据此宣称脱离个人电脑的托管链路完成。原失败工作流和日志全部保留。

计时：首轮2026-10-03 22:09:46北京时间到独立最终核验2026-10-04 01:45:21，总计3小时35分34秒（12934s取整），包含两次失败、调查修补及重试等待。最终应用提交/入口01:10:30到独立完成为34分51秒（2091s）；正式入口内部完成器记2036s，不用该较短值替代总耗时。本轮首次入口缺私有配置路径发生push前，记录保留。

资源收尾：release入口退出后中转/caffeinate原PID91433/91434不存活，自有flowcube-relay临时目录已清除；独立元数据SSH控制连接60秒自动回收，随后退出查询报socket不存在，核对自有socket为空。agent-browser session list为空，本轮脚本/探针自有会话已退出；未关闭用户代理或共享数据库。最终结果记录另保存在发布分支的文档提交，应用发布SHA保持上述14e97aa，不以结果文档提交替代tag或线上证据。
