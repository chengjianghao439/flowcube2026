# v0.14.0 发布候选的样式边界订正

首次候选 `75843dd4cf71e63ff839b860964219b1c39c3777` 的 [Tests 运行 40319938655](https://github.com/chengjianghao439/flowcube2026/actions/runs/40319938655) 未通过页面验收。该次未创建发布 tag，不能算发布成功。失败证据保留，不把后续成功回填为首跑通过。

## 原因与处理

真实 Chromium 对照旧编译器基线产生 119 项差异。其中 96 项为此前已批准的浅色品牌、表面、语义颜色、圆角与阴影；另外 23 项暗色差异暴露出共享 `--radius` 和通用按钮/弹窗规则越界。原 `.dark` 声明块虽逐字没改，仍不能据此推断暗色计算样式没变。

- `frontend/src/index.css`：保留 v0.13.8 基础令牌供暗色和 PDA 使用；新材料只在非暗色且没有 `.pda-root` 或登录字段 `#pda-username` 的根元素覆盖。共享按钮和弹窗增加零特异性的暗色边界，保留普通、危险、禁用与行按钮之间的级联关系；占位文字和表格数字同样限定范围。`.dark` 原块与 v0.13.8 逐字一致。
- `frontend/src/styles/desktop-page-samples.css`：既有精修规则的选择器和值不变，整体置于相同条件的 CSS scope。实际打包目标 Electron 44 与验收 Chromium支持该机制。
- `scripts/browser-smoke/style-design-baseline.cjs`、`tests/fixtures/frontend-style-desktop-0140-delta.json`：保留旧 `frontend-style-v3.json`，另列 96 个明确的浅色设计差异。每个差异必须先匹配旧值才允许投影；不接受自动刷新整个基线。变化只含颜色、圆角、阴影，没有放宽宽高、间距或排版断言。
- `tests/style-design-baseline.test.js`：保留原九项 F12 暗色文字修正的契约，新增浅色差异数量、属性范围、旧值漂移拒绝与原文件不变验证。
- `scripts/browser-smoke/style-compat.cjs`：编译真实全局与桌面 CSS，增加真实 `.pda-root` 上下文，并检查桌面工作区内行按钮。旧夹具里名为 `pda` 的按钮仅指定尺寸，不等于 PDA 页面，现按完整祖先结构区分。

## 实测与反向验证

Node 22 下 `npm run test:style-compat`：3 项契约通过；普通上下文 2070 项、PDA 根上下文 2070 项计算样式均无未批准差异，覆盖 1280/375 宽度、明暗、鼠标悬停、键盘焦点及浮层。触摸模拟点击和弹窗开关通过。

| 行按钮上下文 | 背景 | 圆角 | 高度 | 字号 |
| --- | --- | --- | --- | --- |
| 浅色桌面工作区 | rgb(237,245,255) | 10px | 30px | 12px |
| 暗色同结构 | rgb(75,131,221) | 6px | 40px | 14px |
| PDA 根下的同结构 | rgb(50,94,189) | 6px | 40px | 14px |
| PDA 游客登录标记下同结构 | rgb(50,94,189) | 6px | 40px | 14px |

移除桌面 CSS scope 后，真实浏览器的暗色上下文断言失败；随后原字节恢复文件。旧值漂移也由契约反例拒绝。新增的边界守卫确实能拦截越界，未靠豁免原差异通过。

本次不改 TSX、业务逻辑、接口、权限、数据或版本号。只补跑受影响的 CSS 构建、样式浏览器验收与相关守卫；最终发布仍须等待新 SHA 的全部 CI。这里的 Chromium 夹具证据不能替代 Windows、真实 PDA 与打印出纸验收，也不代表所有暗色业务页面已逐页走查。
