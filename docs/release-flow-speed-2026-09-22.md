# 发版链路修复与 15 分钟目标

状态：本地实现与回归完成，已进入 v0.10.3 正式发布验证。首轮发现生产 Python 3.6 兼容性问题，上传阶段已停止并修复，应用尚未切换。15 分钟仍是待实测目标，不能以本地测试替代。

## 实际瓶颈

从 GitHub Actions 已完成运行读取的时间：

| 运行 | 主要耗时 |
| --- | --- |
| v0.10.1 Browser，35472275472 | 总计约 15 分 7 秒；等检查 183 秒、镜像构建 52 秒、页面和对账验收约 527 秒 |
| v0.9.26 Browser，35447198859 | 总计约 17 分 12 秒；页面与对账验收约 639 秒 |
| v0.10.1 PDA，35472275512 | 构建约 4 分 29 秒，与 Browser 并行；最终发布约 33 秒 |
| v0.10.1 桌面 tag，35473143912 | 完整构建/发布约 4 分 12 秒 |
| v0.10.2 Browser，35609792526 | 在归档传输阶段失败，没有到达 docker load；不属于页面构建失败 |

原页面脚本每次 open/eval/tab 操作都启动一次 npm/Playwright CLI，生产机还可能临时下载运行依赖。只增加 SCP 并行数或超时不能解决这部分固定开销。

## 已实现

- 页面验收改为常驻 Playwright API；每个账号新建上下文，PDA 单独标签页，最后统一关闭浏览器。原 ERP/PDA 清单、受限账号、403 与允许访问对照保留。对账跳转增加加载前后的实际路由检查，修复“跳到 403 却因没有渲染错误而通过”的问题。
- `playwright-core@1.55.0` 锁定依赖随后端镜像交付，生产从运行容器复制、只读挂载到匹配的预装浏览器镜像；不在生产执行 npm 安装。依赖纳入 Security Scan。
- 镜像优先通过本次 Actions 临时 artifact 的短期 HTTPS 地址由服务器下载；签名地址只走 stdin，token 不出 runner。接收器限制 ZIP 条目、大小并验证 SHA256 后原子替换。异常明确回退八片 SCP；控制连接复用，数据流各自保持独立 TCP。临时目录和 artifact 均有清理。
- 保留之前修复的分片/整批一致超时、远端清理续行、外层回退预算和 PDA 等待预算。15 分钟是正常性能目标，不把上线中途强杀成失败作为实现方式。
- `release:prod` 等同 SHA 的检查、Browser、PDA 和 main 桌面验证构建成功后才打 tag，避免两个发布者挤同一个 pending 槽；打 tag 前重新核对 HEAD 和版本，等待期间工作区变化即拒绝；随后只认对应 tag 的桌面发布。任何失败中止收尾，不再以“已提交请求”宣告成功。
- 桌面 GitHub Release 附件发布移除 `continue-on-error`。`release:verify` 除版本和健康外，实际流式下载 EXE/APK 并核对 SHA256（每包最多 120 秒 / 1 GiB），404、缺摘要或损坏包均失败。

## 本地验证

- 发布相关 11 个测试文件 **128/128 通过**：部署、资源上限、回退、PDA、桌面、凭据、HTTPS 完整性/降级、发布顺序、下载摘要。日志 `/tmp/flowcube-release-all-tests-final.log`。
- 真实 Chromium 回环夹具 **6/6 通过**：成功跑完 31 个不同路由、四个 PDA 页面、权限对照与对账回跳；故意破坏 PDA、权限、渲染、对账目标路由均报红。日志 `/tmp/flowcube-browser-live-final.log`。
- 使用原等待参数的本机夹具基准：页面 28.63 秒、对账 18.34 秒，合计 47.04 秒；这是夹具耗时，不是生产基准。随后对账登录改为有界等待，仍保留页面加载窗口。日志 `/tmp/flowcube-browser-benchmark.log`。
- 新增故障测试均先观察失败再修复：例如对账被重定向到 403 的测试在旧检查下返回 0，修复后返回 1；损坏包、下载 404 和缺摘要原先也会被清单字段检查放过。
- 新依赖 npm audit：0 项漏洞。5 个变更工作流通过 actionlint，168 个工作流 Bash 块与 7 个 Node 脚本语法检查通过，两个修改的 shell 入口通过 ShellCheck error 级别检查。
- 所有本任务 Chromium 进程已退出；没有浏览器守护会话留存。

## 尚需正式发布验证

2026-09-22 首轮发布 `35673479203`：Tests、Security、桌面验证及 PDA 构建通过；服务器 Python 3.6.8 不支持接收器使用的 `subprocess.run(text=True)` 和 `Path.unlink(missing_ok=True)`，导致 HTTPS 在下载前失败并回退慢速 SCP。确认仍在上传、旧应用未切换后取消该轮。修复为 `universal_newlines=True` 和仅捕获 `FileNotFoundError` 的清理；新增完整成功路径的 3.6 API 兼容回归，先红后绿。另在服务器实际 Python 3.6.8 中使用临时合成包验证接收、摘要、原子替换和清理成功（不读生产业务数据）。相关 42 项测试通过。首轮不计为 15 分钟达成。

1. 生产到 GitHub artifact 存储的 HTTPS 可达性和吞吐；Python/curl 不可用、链路受限时会明确回退 SCP，可能超过目标。
2. Linux CI 构建镜像后，离线验收依赖复制/挂载与真实生产页面耗时。
3. main 推送起至 Browser/PDA/桌面 tag 全部成功、两个安装包摘要核对结束的实际时间。runner 排队、异常网络、迁移量与生产负载均可能超出 15 分钟。
4. 桌面与 PDA 真机更新安装体验仍需独立验收，不能从 CI 成功推断。

接口依据：[GitHub Actions artifact REST API](https://docs.github.com/en/rest/actions/artifacts)、[upload-artifact](https://github.com/actions/upload-artifact)、[Playwright Docker 依赖与版本说明](https://playwright.dev/docs/docker)。

## 本轮跨境降级与受控中转

第二轮 Python 兼容后确实发起 HTTPS 下载，但直连速度仍只有每秒几 KB，8 路 SCP 聚合采样约 35 KB/s。操作端到服务器 2 MiB 测试耗时 0.35 秒，因此增加仅用于受信操作端中转的 `.relay` 接入口，必须与本次 runner 计算的归档字节数、SHA256 一致才能原子采用，后续镜像 revision 和全部发布门禁不变。`.relay.pending` 仅申请最多 300 秒等待，超时仍降级；不为等待标记放宽校验。临时文件纳入本轮 CI 清理。全链路 15 分钟暂未达成，不把重试时间排除后宣称首次成功。

第三轮 `35675448327` 中转 204,998,209 字节归档耗时 109 秒（含下载、GitHub ZIP 摘要核对及 SSH 上传），服务器 CI 摘要校验通过。部署后页面门禁发现旧对账地址已被前端拆页重定向，脚本却断言保留旧地址；自动回退至原应用镜像，健康通过，迁移不回滚。修正两个脚本使用对账/账款应付和应收四个正式地址；夹具从实际 HashRouter 提取重定向，以旧实现先复现失败后再修复，保持 403 拦截验证。
