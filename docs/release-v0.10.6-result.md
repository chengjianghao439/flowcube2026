# v0.10.6 PDA 扫码测试版发布结果

- 应用发布提交：`d547306251312a00b5ddc24dfb8a02e103e255ae`。2026-09-23 10:56:12～11:25:31（北京时间），从推送到 PDA 发布完成约 29 分钟。
- 同提交 CI：Tests `35812338155`、Security Scan `35812338178`、Deploy Browser App `35812338167`、Build PDA APK `35812338196` 均成功。`Build Desktop Installer` 的 main 验证构建 `35812338185` 也成功，但本次没有打桌面发布 tag，也没有发布桌面新安装包。
- PDA 版本 `0.10.6`、versionCode `141`。线上 `/api/pda/version` 返回 `available=true`；实际下载 APK 为 15,081,567 字节，SHA-256 `2e6f70cef6bbae9c5825e9d05a9847f1914376fee67435478ca45c2ede291b45`，与清单一致。包内 `com.flowcube.pda`、versionName/versionCode 也与清单一致。
- 服务器传输期间曾尝试仓库本地原包中转；第一次因本机未给中转子进程传 GitHub token 而未交付，第二次检查时原 CI 发布已成功，返回 `direct`。此次成功归于正式 CI 直连路径，未依赖本地中转。
- 真机验收待用户完成：PDA 内更新后，到「库存查询」主动开启无焦点扫码测试；验证直接按扫码键、关闭后输入框扫码、上架等页面扫码，以及退出应用后记事本扫码。`RECEIVER_NOT_EXPORTED` 是否能接收 i6310pro 厂商进程的广播尚未被真机证明，不能将 CI 成功写成扫码修复完成。
