# v0.12.0 构建依赖修补与兼容验收计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox tracking.

**Goal:** 消除已证实阻断发布的构建依赖链，同时保留页面与下载可靠性，再经原正式入口发布0.12.0。

**Architecture:** 前后端业务规则不动。桌面使用稳定builder26.15.3及get5官方Downloader扩展接口，以固定版本/源码摘要验证的一处安装补丁注入兼容适配器；样式使用Tailwind4官方构建接点，保留现有主题配置和视觉语义。两条链独立验证后整批审阅，不能通过忽略漏洞、上alpha打包器或复用旧artifact完成。

**Tech Stack:** Node22.23.2、electron-builder26.15.3、@electron/get5.1.0、Undici、Tailwind4.3.3、React18/Vite6、真实Chromium。

## 已知边界

用户已批准调整构建依赖并验证后发布。现有PDA WebView最低配置60，Tailwind4官方Chrome111最低要求，尚无设备；已问品牌/型号/Android版本。这是必须解决的平台边界，电脑端构建通过不能替代。Windows当前signExecutable=false，证书下载binDownload旁路不使用，本补丁不能当成支持未来签名流程。

## 1. 桌面兼容适配（先失败路径，再修补）

文件：新增desktop/build-support/builder-downloader.cjs、patch-builder-download.cjs、tests/builder-download-compat.test.js；修改desktop/package.json/package-lock.json、根package.json、.github/workflows/test.yml。

- [x] 先写真实回环HTTP/代理测试：下载成功内容+进度、503 statusCode、404不得可重试、超时后同adapter下一次新请求成功、外部取消不得ETIMEDOUT、网络cause.code、代理CONNECT实际命中、摘要错误被真实get拒绝，资源finally收尾。
- [x] `node --test tests/builder-download-compat.test.js`先证实缺adapter/未注入自然红，保留原日志。
- [x] adapter实现官方`download(url,target,options)`，每次下载独立AbortController定时器并finally清理；Node Fetch/pipeline保留TLS默认校验；将已有got代理URL转换私有EnvHttpProxyAgent，不能修改全局dispatcher。错误仅兼容原retry读取的response.statusCode/code；用户取消/TLS错误不伪装超时；未知自定义agent/旧选项明确拒绝而非忽略。
- [x] 安装脚本仅接受builder26.15.3和原electronGet.js SHA256 `3452ca5b9a2f29dd6460f0cc9937be2dc1bbbf36809f410649a015b35a607b48`，替换唯一`const configWithProgress = { ...config, downloadOptions };`，加入`downloader`。已补状态验证精确结果摘要；其他漂移退出失败，不泛化替换。get5 override只配合补丁使用。根测试脚本CI接入安装桌面ignore-scripts后显式补丁。
- [x] 验证真实app-builder-lib 503后成功、原重试与锁、官方NSIS固定摘要下载/提取、错误摘要拒绝和补丁变异拒绝；独立规格与质量审查后留检查点。未来上游稳定兼容版本能替代时删除本补丁，不能把它当永久架构。

## 2. 样式构建迁移（保留视觉，确认平台）

文件：frontend/package.json/package-lock.json、postcss.config.js、src/index.css、必要的独立兼容CSS；测试根browser-smoke及CI对应job；主题文档。

- [x] 保留原checkout实际ERP/PDA登录页截图与共享控件/汇总/弹窗旧引擎基线；新旧源码CSS/config与024原版一致，原3.4.19/merge2.6.1真实渲染。绑定请求重定向到登录，未声称体验绑定页；只用脱敏fixture，不连接生产客户账款。
- [x] 配置使用官方`@tailwindcss/postcss:4.3.3`，tailwindcss4.3.3；index.css头部`@import "tailwindcss"; @config "../tailwind.config.js";`，保留现有class暗色、语义色、字号、圆角和动画。不能直接假定JS配置自动加载。
- [x] 按官方迁移指引处理旧shadow/outline/blur/ring、container、space/divide、hover及原自定义utility，保持原员工可见含义；避免批量业务代码替换。tailwind-merge升级到支持4的稳定版本并验证现有`cn`合并规则。
- [x] 原计算样式2070项对比、实际登录/销售/套件/库存/财务代表电脑页18张浅深截图及来源跳转已观察；不只断言配置字符串。
- [ ] PDA合法绑定的仓库代表页/设备内核确认；往来页本次未补验，不把电脑代表页称全系统页面验证。
- [ ] 明确现有PDA内核与官方最低要求的取舍。无法证明平台支持时保留本地候选，不直接升级生产PDA；不得把Android版本当成WebView版本。

## 3. 整批门禁与正式发布

- [x] 四端audit完整0（不改severity/omit/白名单）；lint、app类型、完整前端单测与ERP/PDA构建，后端上传专项，桌面新失败路径专项与独立审阅。
- [x] 同步主题文档和release结果，逐路径暂存、检查diff后提交本地候选。
- [ ] 平台条件解决后才切main快进、确认工作区干净，仅`npm run release:prod`负责推送/门禁/tag/部署。
- [ ] 等同一全新SHA Tests/Security/Browser/PDA/main桌面及tag桌面实际成功；真实下载EXE/APK核摘要、版本150、镜像revision/迁移，保留首轮失败与完整计时。最后释放main、精确收尾自有浏览器/代理中转/SSH，不清用户资源。

本地实际验证：桌面18项及最低22.12均自然通过；根独立复验18项与官方NSIS/7zip固定摘要下载提取通过，SPEC/QUALITY已审。四目录完整audit0。样式基本896项绿后独立发现hidden/窄汇总/响应式divide及真实focus差异；扩至2070项先红39项、修后0差异，独立再运行通过，独立SPEC/QUALITY已ACCEPT覆盖范围；保持平台确认及正式发布步骤未勾选。详见发布结果，不将中间绿灯代表全部。

2026-10-04：真实hover/键盘focus、Dialog开关与现代Chromium触摸回调通过；touch的hoverCapability实际true，不代表现场PDA或hover:none。代表销售/套件/库存/财务电脑页后续真实登录复验已完成；已有前轮业务系统验收不是PDA新样式整页证据，PDA/平台步骤保留未勾选。

QUALITY另独立重新采全2070旧引擎值及242色值完全一致；下载18项独立复跑自然0、CI接线/diff已审。当前代码审查无BLOCK，PDA平台与新SHA远端/原生/生产步骤保持未完成。

2026-10-04 最新指令更新发布安排：用户获知WebView111要求及未验边界后再次要求发布；沿用先自动验收、现场后补的安排，经完整正式门禁发布。设备内核步骤仍未完成，不勾选为兼容已证实；前述等待平台后才发布的安排不再适用于本轮授权。
