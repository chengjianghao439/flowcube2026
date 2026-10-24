# v0.13.8 发布结果

发布于北京时间 2026-10-25。**修复后发布完成**，不是首次候选一次成功。浏览器、后端、PDA 与 Windows 正式包均已发布；两次线上完整核验均为 12/12，实际 EXE/APK 下载 SHA256 一致，GitHub Release 已转为正式版。

## 发布身份与范围

- 应用 main、不可变 tag `v0.13.8`、服务器源码、前后端运行镜像 OCI revision：`54cef45522212f37c9a7fb1152d66e7fce7513ec`。
- 三端版本 0.13.8；PDA versionCode 159，界面与原业务流程保持不变。
- 官网与电脑端页头、提示、表格、图表、搜索、表单和弹窗统一；Logo、官网主标题保留。无新增数据库迁移，无业务状态机、库存/金额、权限表和配置值改动。
- 发布前安全扫描阻断旧依赖，补升 Express 4.22.3 / body-parser 1.20.9 / multer 2.5.0 / Zod 4.6.7，以及 Electron 44.9.3 / undici 7.30.1；传递依赖同步修复。Zod 适配保留中文错误、400 信封、UTC 分钟到期时间，以及打印绑定省略仓库时的公司级零值。详见 backend-api-sql-conventions.md。
- [GitHub Release](https://github.com/chengjianghao439/flowcube2026/releases/tag/v0.13.8)；[官网](https://jixuflow.com/)。

## 最终同提交工作流

| 工作流 / 目标 | Run | 结果 |
| --- | --- | --- |
| Build Desktop Installer（v0.13.8） | [40109410913](https://github.com/chengjianghao439/flowcube2026/actions/runs/40109410913) | success |
| Build Desktop Installer（main） | [40107809281](https://github.com/chengjianghao439/flowcube2026/actions/runs/40107809281) | success |
| Security Scan（main） | [40107809279](https://github.com/chengjianghao439/flowcube2026/actions/runs/40107809279) | success |
| Build PDA APK（main） | [40107809280](https://github.com/chengjianghao439/flowcube2026/actions/runs/40107809280) | success |
| Tests（main） | [40107809275](https://github.com/chengjianghao439/flowcube2026/actions/runs/40107809275) | success |
| Deploy Browser App（main） | [40107809322](https://github.com/chengjianghao439/flowcube2026/actions/runs/40107809322) | success |

所有工作流均核对完整应用 SHA；main 桌面验证构建与 tag 正式发布分开计，不借用其他提交绿灯。

## 验收与安装包

正式入口 `npm run release:prod` exit0；随后单独执行 `npm run release:verify -- --origin https://jixuflow.com` exit0，12/12 一致。后端运行包实际版本为 0.13.8，ready 与公网 health 通过。GitHub 正式附件摘要与官网 EXE 摘要相同。

| 产物 | 字节数 | SHA256 |
| --- | ---: | --- |
| 官网 FlowCube-Setup-0.13.8.exe / GitHub Jixu-Flow-Setup-0.13.8.exe | 112917853 | `325683965187cc8986891b1f7768830bef5cae654abb4c78b7af5bd65d16f8a3` |
| PDA 0.13.8 / 159 | 15219731 | `8e210ab1b7595463b25eab4bdd8efe8cdfad10d87e79513232e9c60dac4ddd62` |

- 本机 Node22 前端全量：416 文件 / 3775 用例通过；页头接口修正后四文件19例、最终后端校验兼容13例通过。两端 lint、正确 tsconfig.app.json 类型检查、桌面/PDA 前端构建通过。
- 初始离线检查曾因默认 Docker socket 和缺少显式测试库分别阻断 Nginx / 打印清理；没有写入业务库。随后 Nginx 在 colima-flowcube 通过；原 CI 主回归 48 条命令通过专属临时实例全部通过（含打印清理），归属门、容器/数据卷/下载目录清理均确认。
- CI 全部27项通过，含独立数据库中的打印机范围、收货、库存/财务/跨期、角色、旧迁移与真实浏览器夹具。后端/桌面本机 audit 零发现；前端仍有2项 moderate，未达既有 high/critical 阻断阈值，完整安全工作流通过。
- 实际 Chrome 打开线上首屏、更新摘要和下载区；Logo/主标题保留，Windows 链接与页脚桌面版本为0.13.8，PDA为0.13.8。只读公共页面，未读取真实客户/账款或执行业务写入。见 [首屏](release-evidence/0.13.8/live-homepage.png)、[更新摘要](release-evidence/0.13.8/live-updates.png)、[下载区](release-evidence/0.13.8/live-downloads.png)。本人验收标签已关闭，用户原标签保留。
- Windows 实际安装/旧客户端更新弹窗、PDA 真机扫码/安装、实际出纸未验证。CI、网页、摘要与数据库证据不代替现场设备验收。

## 失败、修复与交付路径

1. 首次入口 GitHub API TLS 超时，发生在推送前。随后仅为本次命令设置现有代理与 GitHub API 的代理例外；没有更改仓库或生产网络配置。
2. `e1fe59b` 候选：Security Scan [40106788689](https://github.com/chengjianghao439/flowcube2026/actions/runs/40106788689) 因后端/桌面高危依赖失败；Tests [40106788493](https://github.com/chengjianghao439/flowcube2026/actions/runs/40106788493) 的样式夹具漏编译退役工具类。浏览器 [40106788469](https://github.com/chengjianghao439/flowcube2026/actions/runs/40106788469) 在门禁处拒绝，未切换；保留失败与后续取消记录。
3. `4a61411` 候选安全扫描通过，但 Tests [40107414323](https://github.com/chengjianghao439/flowcube2026/actions/runs/40107414323) 的打印机绑定回归发现 Zod 缺省输出兼容问题；已以真实路由红→绿修复，后续取消被替代运行。本机监听另遇 API 查询重试耗尽，不能将监听失败说成 CI 成功。原失败子任务记录保留。
4. 最终 `54cef45522212f37c9a7fb1152d66e7fce7513ec` 完整重跑成功后才切换应用、发布PDA、推送tag并发布Windows包；未复用或覆盖任何已发布同版本字节。

实际交付路径：**镜像 CI 直连 HTTPS；PDA 与 Windows 原包经本机代理中转**。镜像本机分段下载未完成时，服务器已从 CI 取得并验证同摘要归档；不能把它记成本机中转交付，也不是 SCP 回退。PDA 中转145.2秒（下载校验142.5、上传2.6），Windows192.6秒（183.0、9.6）；接收工作流全部成功。本次仍依赖操作端代理/Mac在线，不作为完全托管链路验收。

首次正式入口 2026-10-24T15:23:07Z 至独立验收/资源复核 16:06:48Z，共 **43分41秒**；最终应用提交 15:37:12Z 至同一终点 **29分36秒**。最终入口至返回27分37秒，其中编排器报告同SHA等待、部署及下载验收1652秒；排队、传输和失败修复未隐藏或重设起点。

## 发布成功后的镜像与磁盘收尾

2026-10-25北京时间复核：服务器源代码与运行镜像均为最终SHA，后端实际包0.13.8。最终磁盘50,018MiB总量、18,669MiB已用、**29,097MiB可用（约28.4GiB，使用40%）**。发布后两次盘点的三个业务容器ID、启动时间、重启次数与标准化后的挂载集合一致；MySQL原容器保留，重启次数0，ready健康。

共17个镜像，全部运行/停止容器共3个引用；14个镜像无容器引用。名义镜像大小合计7,528,699,353字节，含共享层，**不等于可释放空间**。发布后的盘点阶段未删除任何镜像、容器、数据卷、备份、业务文件或日志，未执行prune；镜像清理释放量0。

保留当前前后端、MySQL和发布浏览器门禁镜像；上版前后端作为恢复候选保留。本版无新增迁移、旧后端两个写入契约标签存在，但没有实际回退演练，且旧版包含本轮已修复的依赖漏洞，不能承诺常规回退安全。其余历史镜像和旧MySQL镜像用途/相同副本恢复能力未完成核实，继续保留。

当前 CI 剩余镜像 artifact 仅为SBOM/provenance（246,054字节，未过期），不能代替完整镜像归档；本轮没有证明 registry/备份可恢复相同镜像ID。**精确拟执行删除清单为空：没有已满足用途、恢复证明和授权前提的安全清理对象。** 不因发版成功推断删除授权；如需以后清理，须重新确认用途/恢复证据及逐项清单，再按低IO规则取得必要永久删除确认。

| 完整镜像 ID | 标签 | 名义字节数 | 全部容器引用 |
| --- | --- | ---: | --- |
| `sha256:0195b3281333ff317d9c63b3d61f5d887a53434ffc11705492a80ebe1e1baf99` | flowcube-frontend:bd011c1db9a9c14a08fc786e7836ed5f68596eac | 66939713 | 无容器引用 |
| `sha256:0b696fee2c134e2bdd812068f4ccebf38161235b7298f3381490e3794866bdae` | flowcube-backend:fe3716452043ed895d57a3fa4cecfe96c59a9406 | 403901053 | 无容器引用 |
| `sha256:2e14dbb8f1f6dd909db693222dc518ab02cf13632cbac0e44f6d929db3b201ca` | flowcube-backend:734ed9924a3b6d3051962a3f06f81f5a04fc4213 | 403562609 | 无容器引用 |
| `sha256:476e8704320a99a059bdf9ea861280fac5cb35b8d8104328b1bf94f13b5e2936` | flowcube-backend:bd011c1db9a9c14a08fc786e7836ed5f68596eac | 403506798 | 无容器引用 |
| `sha256:4d1f2a9f2b1669fb8f81fea20e0e18abb24392c8d6b44be292c5a9c2a6e1f74a` | flowcube-backend:8db3e40f22e3949b50d1d698086c1a9cac2c183f | 403562368 | 无容器引用 |
| `sha256:6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39` | mysql:8.0.46 | 799032353 | /flowcube-mysql |
| `sha256:8a461db088d3b546203b41ea8496e497597bd0bc9a08a331ae5804c30a2a4c9e` | mcr.microsoft.com/playwright:v1.55.0-noble | 2646562584 | 无容器引用 |
| `sha256:a123df39bc7c56bb6e40f8e5ef90469cc191dd7afcbf6e0d618c61a12e225dde` | flowcube-mysql-current:8.0.45 / mysql:8.0 | 785917511 | 无容器引用 |
| `sha256:a1a386aec1739c23b50c059e513fb538c9db48cb36b6f13f221579e64f9df41a` | flowcube-frontend:734ed9924a3b6d3051962a3f06f81f5a04fc4213 | 66942079 | 无容器引用 |
| `sha256:a65434e8a94ec8b093db306bc269b2315843e6d083b7254c3386e62a4a0840e3` | flowcube-frontend:54cef45522212f37c9a7fb1152d66e7fce7513ec / flowcube-frontend:latest | 67140848 | /flowcube-frontend |
| `sha256:c0610c759604388f08303686056a07e78a4de1b525197a9ef23db9767f22277b` | flowcube-frontend:29b1cf09b8470fd35c7d9c2b1ad6eb70e9a057f8 | 66954082 | 无容器引用 |
| `sha256:d72933f7d1b3f04911f691fe9c9b86967361c45139d112bc55583ab3b052c955` | flowcube-frontend:710d094e0669d229919c4c20d186121c3f58c7d7 | 66930793 | 无容器引用 |
| `sha256:e32f1d89bc9727e1676ea68044534dc352775727b27c78c3dfd8b49df101d519` | flowcube-frontend:8db3e40f22e3949b50d1d698086c1a9cac2c183f | 66942079 | 无容器引用 |
| `sha256:e7e4cb65e06104e56ef40406cd29cc6c1afbac4dfe6f3ad29bde09f4bc444a89` | flowcube-backend:710d094e0669d229919c4c20d186121c3f58c7d7 | 403499124 | 无容器引用 |
| `sha256:f121a94547fa5b05b03f4925a0afe74c74c18af7e85cf6df71c3e3a089f1f27c` | flowcube-frontend:fe3716452043ed895d57a3fa4cecfe96c59a9406 | 66959803 | 无容器引用 |
| `sha256:f888a68a1cc5fc4c2c83715d1bba6b70cc9601039357bb1cc22246ab7f698b9a` | flowcube-backend:29b1cf09b8470fd35c7d9c2b1ad6eb70e9a057f8 | 403617940 | 无容器引用 |
| `sha256:febd1809025725e694aebadbb49e11cdea22e5fa7b16dc49d8772d8089bd1ce4` | flowcube-backend:54cef45522212f37c9a7fb1152d66e7fce7513ec / flowcube-backend:latest | 406727616 | /flowcube-backend |

机器可读事实见 [验证清单](release-evidence/0.13.8/verification.json) 和 [镜像及容器清单](release-evidence/0.13.8/image-inventory.json)。结果文档和截图仅提交到本地 `codex/release-0.13.8` 记录分支，不为上传记录再次触发生产部署；本地main、origin/main、tag与线上应用均保持上述发布SHA。
