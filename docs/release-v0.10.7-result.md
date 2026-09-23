# v0.10.7 PDA 默认扫码与上架手输发布结果

- 应用发布提交：`851688c0df78e9bd3c4c808a14aab0a854bb4cfd`。2026-09-23 12:25:48～12:37:29（北京时间），从推送到 PDA 发布完成约 11 分 41 秒。
- 同提交 CI：Tests `35818295451`、Security Scan `35818295515`、Deploy Browser App `35818295464`、Build PDA APK `35818295459` 均成功。`Build Desktop Installer` 的 main 验证构建 `35818295457` 也成功；本次未打桌面发布 tag，未发布桌面新安装包。
- 本地验证：前端类型检查、lint（0 error）、浏览器与 PDA 前端构建通过；前端全量单测 99 文件 / 495 例通过；Android `testDebugUnitTest assembleDebug` 通过。扫码聚焦、版本摘要和文案守卫通过。首次并行执行的前端全量单测曾失败，顺序重跑 99 文件 / 495 例通过；未将首次运行当作通过证据。
- 线上 `/api/health` 正常，`/api/pda/version` 返回 `0.10.7` / versionCode `142` / `available=true`。实际下载 APK 为 15,081,749 字节，SHA-256 `98a4c200a3bb73df49c9f3bdb4e9d4752de44b34204c65c718366902382db44e`，与更新清单一致；包内 `com.flowcube.pda`、versionName/versionCode 也与清单一致。
- 真机验收待用户完成：安装新版本后不进库存查询开关，直接到待上架任务页扫码；确认初始不弹键盘，点下方扫码区域才弹键盘；手动输入库存条码与货架条码仍可完成原有校验；将应用退到后台后确认记事本恢复键盘扫码。v0.10.6 中用户已确认主动开启无焦点接收后 PDA 各页直接扫码正常，但这不能替代 v0.10.7 的默认启用和新手输交互验收。
