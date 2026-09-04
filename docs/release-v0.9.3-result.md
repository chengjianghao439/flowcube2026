# v0.9.3 发布结果

验收时间：2026-09-05 01:33（北京时间）。**浏览器、Windows 桌面安装包、PDA 均发布成功**，PDA versionCode 为 **111**。

发布提交：`c31032e45ff82646c01f1358242f4e1a492c2f53`；`main` 与 `v0.9.3` 标签指向该提交。[GitHub Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.9.3)。

## 范围与主要改动

在独立工作树准备并发布，核对后按路径提交，共 36 个文件。原开发目录的个人 Codex 配置、开发数据库工具及其他未提交改动保留，未混入发布。发布候选范围与验证记录位于该提交的 `docs/release-v0.9.3-validation.md`。

- 应用镜像改为在 GitHub runner 编译，生产核对归档摘要和提交号后加载；失败恢复旧应用镜像。
- 发布页面验收限制为 1 CPU、1 GiB（无额外交换）、256 个进程，增加超时、信号传播与清理保护。
- 修复监控重叠、Docker/TLS 探针超时、连接数读取失败误判，以及没有新增业务时的备份恢复误报。
- 部署客户端精确 CORS 来源配置能力，保留现有生产兼容配置；项目凭据代输授权及相关部署文档同步维护。

## 实际发布证据

以下均为同一个发布 SHA，状态为 success：

| 项目 | Actions | 完成时间（北京时间） |
| --- | --- | --- |
| Tests | [33899611467](https://github.com/chengjianghao439/flowcube2026/actions/runs/33899611467) | 01:17:08 |
| Security Scan | [33899611565](https://github.com/chengjianghao439/flowcube2026/actions/runs/33899611565) | 01:16:04 |
| 浏览器生产部署 | [33899611395](https://github.com/chengjianghao439/flowcube2026/actions/runs/33899611395) | 01:28:16 |
| PDA 构建及发布 | [33899611358](https://github.com/chengjianghao439/flowcube2026/actions/runs/33899611358) | 01:28:48 |
| v0.9.3 标签触发的 Windows 正式发布 | [33900783288](https://github.com/chengjianghao439/flowcube2026/actions/runs/33900783288) | 01:32:49 |

浏览器日志 01:27:01 记录页面烟雾通过，01:28:09 记录对账回跳与发布门禁通过；实际前后端镜像 OCI revision、服务器 Git HEAD 均与发布提交一致，后端 package 版本为 0.9.3。辅助验收容器已清理。01:28:49 复查可用内存约 2.4 GiB、交换使用约 524 KiB，MySQL healthy。

发布前验证：89 项部署/运维/CORS/客户端 Node 回归、69 项前端单测通过；两端 lint（前端仅 5 条既有 warning）、app TypeScript、ERP/PDA Web 构建、actionlint、ShellCheck、Bash 语法和候选文件泄漏扫描通过。审查发现的嵌套 timeout 信号传播问题已用真实子进程回归验证修复。

## 线上版本与产物核验

01:32:57 复查 `/api/health`、`/latest.json`、`/api/app-update/latest`、`/api/pda/version` 全部 HTTP 200；桌面与 PDA 清单均为 0.9.3，更新说明包含本版内容。桌面/PDA 下载地址 HEAD 均为 200，PDA 下载响应版本代码为 111，大小与清单一致。

| 产物 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| Windows 安装包 | 82561882 | `911f4c1b731fc9647106c55ef91ade2af202f064ec5ba7294471aef4ec844d50` |
| PDA APK | 16534929 | `d3f7a18f10575676570a3a1b166b3484fb5eef4f6db9c2d372388a2e618da04b` |

Windows GitHub Release 资产的大小和 GitHub 提供的 SHA-256 与生产清单一致；原始清单中的相对地址解析后与后端返回的 HTTPS 绝对地址一致。PDA 接口已校验 APK 与发布清单摘要。未在 Mac 上重复下载或安装 Windows/PDA 包；原生设备上的自动更新弹窗、安装及物理打印不在本次验收范围。

## 备份与保留事项

- 01:09 发布前已备份数据库（135 表）、配置、旧镜像 ID 与客户端清单，另复制到 Mac 并核验摘要。本版没有新增数据库迁移。
- 生产 `CORS_REFLECT=1` 保持原配置；精确来源收窄需要另行验证实际客户端后切换。自动异地备份仍待指定目的地与凭据。
- 本次实际部署验证了资源保护流程；无法据此宣称上次云盘 I/O 故障的唯一根因已经确定或永不复发。
- 本文件是发布完成后的本地验收记录；相关实现和部署文档已随发布提交。未为补充事后记录再次推送 main，以免触发重复生产部署。原开发工作区仍保留，正式发布工作树位于 `/Users/chengjianghao/.config/superpowers/worktrees/flowcube/release-v0.9.3`。
- 发版工作树占用 main 的收尾遗漏已纠正：该目录已切回 `codex/release-v0.9.3`，提交与文件不变，main 已释放。原开发目录仍在 `codex/local-codex-setup`，未提交改动保留；只读切换预检发现与新版 main 有重叠，需要先保存并处理差异。
