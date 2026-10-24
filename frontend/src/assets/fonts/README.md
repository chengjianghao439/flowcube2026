# 本地字体资源

Inter（400–800）、Noto Sans SC（400–700）与 JetBrains Mono（500–600）采用 Google Fonts 官方 CSS2 接口提供的 WOFF2 可变字体 Unicode 子集，下载于 2026-10-25。

来源：`https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=JetBrains+Mono:wght@500..600&family=Noto+Sans+SC:wght@400..700&display=swap`。保留原资源文件名，添加字体族前缀便于识别。全部字体按 SIL OFL 1.1 分发，许可证位于 `frontend/public/fonts/OFL-*.txt`，构建时一并复制。

`frontend/src/styles/fonts.css` 保留官方 `unicode-range`，页面只请求实际用到的子集。URL 使用 Vite 项目根路径 `/src/assets/fonts/`，避免 Tailwind 合并 CSS import 后丢失相对路径基准；Vite 构建后转换为 Electron 可用的相对哈希资源。更新字体时同时核对产物中的字体、内联子集与许可证，并实际打开构建后的页面检查中文加载。
