# 极序 Flow 系统图标

用户确认以蓝底双曲线 F 替换系统品牌，并授权网页、桌面和 PDA 正式发布。本次发布目标为 v0.9.9；实际生产结果另记录于发版验收文档。

## 素材与生成

- 已确认图稿：`docs/branding/flow-icon-approved.png`，1254 × 1254 PNG，SHA-256 `d3513e4f162518b504287966ccfe64f5950ca066d2292157f8b064636927eb7d`。保留原始图稿，不把 PNG 宣称为矢量母版。
- 导出脚本：`scripts/generate-brand-icons.cjs`，需要 Node 22 与 `sharp`（本次工具环境为 0.35.4）；可通过 `NODE_PATH` 指向已有工具环境中的 sharp。应用运行及 CI 构建直接消费已提交的图标，不依赖生成工具。
- 导出时将图稿白色标记提取为透明前景，统一纯蓝底 `#0B339A`，保留轮廓、间距与原有留白。
- 网页：16/32 像素标签图标、180 像素触屏图标、192/512 像素兼容资源及多尺寸 favicon.ico。HTML 图标带版本参数，React 品牌图由 Vite import 生成哈希 URL，兼容浏览器、Electron file 与 PDA 内置资源。
- 桌面：`desktop/build/icon.ico` 包含 16/24/32/48/64/128/256 像素 PNG 图层，另提供 PNG、ICNS。Windows 程序、NSIS 安装器与卸载器均配置图标；窗口使用打包内的 `build/icon.png`。
- Windows 配置保持资源编辑启用、签名关闭；`signAndEditExecutable: false` 会连图标一起跳过，故改用 `signExecutable: false`。依据当前 lockfile 对应 electron-builder 26.15.3 的实际实现与 [v26 官方说明](https://www.electron.build/v26/docs/win/)。
- Android：五档密度普通、圆形及透明前景，自适应背景为相同纯蓝。前景按完整源画布的 66% 居中，以满足 [Android 自适应图标安全区](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)。主题图标复用透明前景。已有各方向启动屏保留尺寸、替换品牌；启动背景统一白色。

## 页面分工

官网品牌、ERP/PDA 登录与 PDA 首页使用 `SystemBrand`；`BrandLogo` 仅调整无图回退所用的系统图标，公司 Logo 查询、公司图优先、文字回退与打印行为不变。业务模块中的 Layers 图标仍表示容器/层级等业务含义，不属于品牌替换范围。

先前上传的独立预览素材仍可通过 `/versions/brand-assets/jixu-flow-icon-refined-2026-09-07.png` 访问；应用使用随代码构建的本地资源，不依赖该预览地址。

## 验证

本地前端 lint 为 0 错误、5 条既有 react-refresh 警告；指定 `tsconfig.app.json` 的类型检查、ERP/Electron 与 PDA Web 构建通过，客户端回归 31/31 通过。已在独立本地开发服务实际检查官网、ERP 登录与 PDA 登录页，新图标加载正常，浏览器无页面脚本错误；16/32/48 像素图标已做视觉检查。Android 五档前景均经像素半径检查位于安全圆内。Windows PE 校验脚本对含新图标的样本通过、对无图标样本拒绝，并已加入正式 Windows CI 检查实际打包程序的全部 7 个图层摘要。AGENTS.md 已同步系统品牌与 Windows 图标打包规则；主开发目录的未提交德邦接口改动不包含在此次发布中。
