# 极序 Flow v0.14.3 发布结果

## 版本与范围

- 应用提交为 `04d033abcd622d61e5816d1bc3c34d9c79f5131c`，发布标签为 `v0.14.3`。浏览器、Windows 与 PDA 版本均为 0.14.3，PDA versionCode 为 163。
- 以销售订单为基准统一宽表、查询、空态、草稿和返回交互，纳入本批 ERP、仓库、打印、PDA 与财务修复。独立工作树保留的实验性工具、私有环境资料和历史分支留在各自原位置。纳入主仓库已核实的表格空态修复及对应测试。
- 无新增数据库迁移。前端锁文件升级 `follow-redirects` 到 1.16.3，处理了发布前扫描发现的高危项。
- [更新说明](release-notes/0.14.3.md) · [隔离环境实操](ui-remediation-final-2026-11-13.md) · [续测与恢复演练](ui-remediation-followup-2026-11-13.md)

## 发布过程

| 北京时间开始 | 候选提交 | Tests | 网页部署 | 结果 |
| --- | --- | --- | --- | --- |
| 14:19:31 | `fcaeca7` | [43377922477](https://github.com/chengjianghao439/flowcube2026/actions/runs/43377922477) | [43377922298](https://github.com/chengjianghao439/flowcube2026/actions/runs/43377922298) | 门禁停止。修正 Playwright 的 Ubuntu 运行镜像及旧夹具。 |
| 14:24:24 | `b2d81c2` | [43378490702](https://github.com/chengjianghao439/flowcube2026/actions/runs/43378490702) | [43378490872](https://github.com/chengjianghao439/flowcube2026/actions/runs/43378490872) | 门禁停止。更新 PDA 分拣反馈断言、跨期退货关联样本及收货打印状态依赖。 |
| 14:33:02 | `04d033a` | [43379487649](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487649) | [43379487767](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487767) | 网页和 PDA 成功。Windows 首次发布失败，同一运行重试后使用原安装包完成。 |

前两轮结束于生产部署的 Tests/Security 门禁，线上当时仍为 v0.14.2。正式入口使用现有 Mac 代理与 SSH 信任链自动中转 CI 产物。

## 发布前验证

- Node 22 前端单测 429 个文件、3,907 项通过，应用 TypeScript、Web/桌面与 PDA 构建、前后端 lint 通过。前端有两条原有 Fast Refresh 警告。
- 本机真实 Chromium 自动化验证 PDA 扫码及登录/供应商月结 31 项，隔离环境实际鼠标键盘操作见上文。新建专属 MySQL 实例补跑 39 组业务回归；商业套件锁等待用例在启用 `performance_schema` 的独立实例通过，库存集成另有 96 项通过。本轮专属验证容器均正常停止，数据卷保留。
- Windows 真机安装及更新弹窗、PDA 实体设备扫码和物理出纸待验。历史低频库存预占 503 在构建版续测未复现。

## 线上验收

北京时间 15:06:16 完成核验。从首轮启动计 46 分 45 秒，从最终提交发版入口启动计 33 分 14 秒。

- 同一 SHA 的 [Tests（28/28）](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487649)、[Security Scan](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487855)、[网页部署](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487767)、[PDA 发布](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487639)和 [main 桌面验证构建](https://github.com/chengjianghao439/flowcube2026/actions/runs/43379487530)均通过。[Windows 正式发布](https://github.com/chengjianghao439/flowcube2026/actions/runs/43381289797)第 2 次运行通过。
- `main` 和 `v0.14.3` 均核对为完整发布 SHA。生产网页门禁、服务器本机和公网就绪检查通过。`npm run release:verify -- --origin https://jixuflow.com` 退出码为 0，12 项通过，包括两个安装包从公网实际下载后的 SHA-256 校验。
- Windows 首轮在容器读取暂存 EXE 时遇到 `EACCES`，官网安装包、更新清单和 GitHub Release 当时均未写入本版。本机私有 `umask` 下中转文件为 0600，生产镜像的发布命令降权至 UID 1000。用同一镜像复核后，仅对本次待公开的暂存安装包设置 0644。核对原 CI artifact `14016756884` 的 ZIP 摘要、来源 SHA、原 run 和 EXE 摘要后，重跑失败的发布任务，继续使用原包。暂存目录在发布后已核对清理。后续自动发布仍需显式保证此暂存文件对容器内发布进程可读。
- 应用镜像通过服务器 HTTPS 接收与 SHA-256 校验，PDA 通过 Mac 自动中转，Windows 使用校验后的原包暂存恢复。[GitHub 正式 Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.14.3)

| 公网产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| Windows EXE（官网与 GitHub 附件一致） | 117749830 | `06d35cecdc7b7c00512a4f8d3f8f3ac866961f054fca6b55645989c2ddc7ad86` |
| PDA APK，163 | 20148917 | `fc8cfaed2c7ad932bf37ae256a7708bb7b82c4f01cc86cb7dc727e863a6936f9` |

## 生产数据和磁盘

- 发布前生产数据库快照完成独立文件校验。迁移器报告没有待执行的迁移。生产 MySQL 容器 ID、启动时间、重启次数、镜像与挂载核对一致。两份合成数据的独立恢复演练记录见上文链接，生产快照的恢复演练待单独验证。
- 前端镜像为 `sha256:da64d0d4324503b8ffec8c26d069dd9845957a5d744603261a8b23bbf8691b63`，后端为 `sha256:3c62628d7fd8acb2331a688500a58b265e77e2fa04d1bde03e5438d8ae0c87a1`，两者 OCI revision 均为本次发布 SHA。保留当前和上一版应用镜像、MySQL、网页门禁镜像及历史镜像。29 个镜像中 26 个没有容器引用，其中包含发布门禁所需镜像；历史镜像的用途和同身份恢复证据仍待核实，本次拟清理集合为空。
- 根分区可用空间由 27,886 MiB 变为 27,484 MiB，占用率从 42% 变为 43%。没有清理 Docker 镜像。桌面目录按既有保留数量轮换 v0.13.5，轮换前将该包和元数据备份到服务器独立目录并逐字节比对。轮换后复核备份 EXE 的摘要与 GitHub 仍公开的 v0.13.5 附件一致。
- 独立发布副本已停在 `v0.14.3`，Mac 主工作区原有本地改动保留。此结果记录仅留在本地。
