# 发布资源隔离修复计划

目标：降低生产发布对 2 核、约 3.5 GiB 主机的 CPU、内存和磁盘压力；超时退出且保留旧应用回退能力。

架构：GitHub Actions 构建带提交标识的应用镜像，通过 SSH 传输校验过的镜像归档；生产只加载、迁移、切换和验收。浏览器验收顺序运行并限制资源，监控单实例运行，外部命令均有时限。

技术：Bash、Docker、GitHub Actions、Node 内置测试运行器；测试使用隔离目录与模拟命令，不向生产写测试数据或发送通知。

证据：v0.9.2 浏览器部署于 2026-09-04 21:19:53（北京时间）完成门禁，PDA 于 21:20:26 完成；22:23 仍可访问。云平台随后确认磁盘读写受限，但现有证据不能把故障归因于一个具体进程。发布流程确有生产编译、无上限浏览器容器、无时限 Docker 请求等风险。

- [x] 核对实际 SHA 的 Actions 时间与故障记录，读取发布/回退/监控实现。
- [x] 先补失败用例：拒绝缺失/损坏/错 SHA 镜像，加载失败不切换，资源限制与门禁超时清理，监控不重叠。
- [x] CI 构建归档；生产加载前检查空间/摘要，加载后检查镜像提交标识；保持同 SHA 检查与回退。
- [x] 门禁加 CPU/内存/进程上限、命令超时和容器清理，移除自动 prune。
- [x] 监控加单实例锁与 Docker/TLS 时限，避免卡住后每 5 分钟累积任务。
- [x] 运行隔离回归、Bash/YAML 检查，检查最终 diff；同步 AGENTS、部署/发布技能、故障报告。
- [ ] 完成可审阅变更后，依项目明确发版授权边界处理上线；不能把本地通过写成线上生效。

验证命令：`bash scripts/with-dev-env.sh node --test tests/audit-deployment.test.js tests/deployment-resources.test.js tests/ops-monitor-restore.test.js tests/audit-tooling.test.js`；相关 Bash 文件逐个 `bash -n`。

不做：生产压力复现、整盘 Docker 统计、删除镜像/缓存/数据卷、猜测唯一事故根因。

上线前只读核查（2026-09-05 01:01）：生产 timeout/flock/sha256sum/Docker 均存在，指定 Playwright 镜像已缓存；/tmp 与项目目录可用 16430 MB，使用率 66%，HEAD 仍为已发布 v0.9.2。未启动生产构建或验收。

验证完成：57 项隔离/真实进程超时回归通过；actionlint、ShellCheck、bash -n、git diff --check 通过。依 AGENTS 第 1 节，新的 main 推送/生产发版需明确授权；当前交付为已验证的本地改动与可审阅范围，未推送。

用户已于 2026-09-05 明确要求发布新版本，本计划修复纳入 v0.9.3；授权已具备，执行与验收见 `docs/release-v0.9.3-validation.md` 和相应 Actions。
