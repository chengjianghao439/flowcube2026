# v0.9.9 系统图标发布验收

发布提交：`b6e92535063ce41add7978a62440e00e48f8f7a8`，tag：`v0.9.9`。三端版本 0.9.9，PDA versionCode 117。用户已授权替换网页和 App 图标并发布。

## 变更与本地验证

官网、ERP/PDA 登录、PDA 首页、网页标签、Windows 程序/安装器/卸载器、Android 普通/圆形/自适应/主题图标及启动画面统一使用蓝底双曲线 F。公司 Logo 与业务流程不变。实现文档及 AGENTS.md 随发布提交同步。

- 前端 lint：0 错误、5 条既有 react-refresh 警告。
- `tsc -p frontend/tsconfig.app.json --noEmit`、ERP/Electron 和 PDA Web 构建通过。
- `npm run test:audit-client`：31/31 通过。
- Android `:app:processDebugResources`：BUILD SUCCESSFUL，67 项任务；五档自适应前景均位于中心安全圆。
- electron-builder 配置校验通过；Windows PE 图标检查对无图标样本拒绝，对新图标样本通过。
- 独立本地开发服务实际检查官网、ERP 登录、PDA 登录及 16/32/48 像素图标；截图与本地构建日志保存在 `output/branding/v0.9.9/`。

## 同一提交的 CI

| 工作流 | 运行 | 结果 |
|---|---|---|
| Tests | [34083420997](https://github.com/chengjianghao439/flowcube2026/actions/runs/34083420997) | success |
| Security Scan | [34083420992](https://github.com/chengjianghao439/flowcube2026/actions/runs/34083420992) | success |
| Windows tag 正式发布 | [34083432738](https://github.com/chengjianghao439/flowcube2026/actions/runs/34083432738) | success |
| Windows main 验证构建 | [34083420983](https://github.com/chengjianghao439/flowcube2026/actions/runs/34083420983) | success |
| Deploy Browser App | [34083420971](https://github.com/chengjianghao439/flowcube2026/actions/runs/34083420971) | success |
| Build PDA APK | [34083420986](https://github.com/chengjianghao439/flowcube2026/actions/runs/34083420986) | success |

Windows 正式 CI 在实际 `极序 Flow.exe` 中核对 7 个图标图层，摘要全部匹配。

## 线上证据

- 服务器 Git HEAD、前端与后端镜像 OCI revision 均为本次完整发布 SHA。
- 官网和 ERP 登录页已实测显示新图标、图片加载成功，无页面脚本错误。32 像素 favicon 的公网/本地 SHA-256 均为 `c65e12ff8daddc31f246c7b463afc9083296d42e4a38c028c4eecbbef75ab60b`；哈希品牌资源 `/assets/flow-icon-CK-wnIZw.png` 均为 `17031d46f857b2ddcebbebbb1d4c19b747e2f91c431564db974148a7b703295f`。
- `/latest.json` 与 `/api/app-update/latest` 均为 0.9.9，更新说明与本次 release notes 一致。
- 公网下载 Windows 安装包 112,332,596 字节；SHA-256 `b0e4c0293b1a11710267159082c30d7922145194bcf355fe75ef403b56fde39a`，与更新清单及 GitHub Release digest 一致。
- `/api/ready` 返回 ready，`/api/health` 返回 ok。
- PDA `/api/pda/version` 为 0.9.9 / 117，available=true；正式 APK 的包名 `com.flowcube.pda`、versionName 0.9.9、versionCode 117 经 aapt 实测一致。下载大小 15,013,608 字节，SHA-256 `0e2d688a0d9849e7eef8e25d67f91d38ab9e3d39421c547335326cfe12c6a80f` 与发布清单一致。
- 正式 APK 内置 Web 品牌图摘要与本地一致；五档密度共 15 个原生图标解码像素与源文件一致，自适应 XML 的 foreground/monochrome 均引用新透明前景。
- 网页部署的页面烟雾和对账回跳门禁均随工作流通过；验收容器已退出。最终公网 ready 仍正常。

## 工作区与验收边界

主开发目录已快进到本次发布提交。原有德邦适配器、测试、接口文档内容摘要前后一致，AGENTS.md 中德邦未提交段落完整恢复；未纳入本次图标提交。临时定向 stash 已核对并清理。发版工作树停在 `codex/release-v0.9.9`，未占用 main。

本任务创建的本地开发预览进程已停止；`agent-browser --session flowcube-v099-brand close` 后会话列表为空。

本次验证包括页面、平台资源编译和安装包内容，不等同于 Windows 实机安装/快捷方式缓存刷新或 Android 真机启动器、相机与物理打印验收。安装更新后操作系统才使用新应用资源。
