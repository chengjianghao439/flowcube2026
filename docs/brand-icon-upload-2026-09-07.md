# 系统图标素材上传记录（2026-09-07）

用户确认蓝底双曲线 F 打磨稿，并要求上传服务器。本次仅上传独立 PNG 素材；网页内置品牌、favicon、桌面与 Android 安装包图标尚未替换，未触发应用发布。

- 本地素材：`output/branding/jixu-flow-icon-refined-2026-09-07.png`
- 尺寸：1254 × 1254，PNG；此文件为图像编辑生成稿，尚未制作矢量母版及小尺寸图标。
- 服务器路径：`/var/www/flowcube-downloads/versions/brand-assets/jixu-flow-icon-refined-2026-09-07.png`
- 公网地址：https://jixuflow.com/versions/brand-assets/jixu-flow-icon-refined-2026-09-07.png
- SHA-256：`d3513e4f162518b504287966ccfe64f5950ca066d2292157f8b064636927eb7d`

复用当前 nginx `/versions/` 静态挂载，在独立 `brand-assets` 目录发布，未修改服务器代码、nginx/Caddy 配置、安装包或更新清单，未重启服务。先上传临时文件并校验摘要，再以不覆盖已有文件的方式建立最终文件。

本次实测公网 GET 返回 HTTP 200、`Content-Type: image/png`，下载文件 SHA-256 与本地及服务器一致。

已检查 AGENTS.md 第 9 节系统品牌与公司 Logo 分工及第 10 节发布规则：此次只存放素材，未改变现行行为，AGENTS.md 无需调整。公司 Logo 配置未改动。后续接入应用仍需按正式发布流程构建、验证及发布。

用户随后授权替换网页和 App 并发布，已在同日完成 v0.9.9。上述内容保留为独立素材上传时的记录；应用已接入随代码打包的新图标，详见 `brand-icons-2026-09-07.md` 与 `release-v0.9.9-result.md`。
