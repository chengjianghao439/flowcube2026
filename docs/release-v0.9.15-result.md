# v0.9.15 发布记录

## 范围

用户于 2026-09-13 明确要求所有改动提交并发版。基线为 v0.9.14 / 4897276。

- `operations-optimize-20260912`：10 个已提交的性能、开单、采购建议、报表和模块回归修复，至 93e3377。
- 主目录：官网第一版采用，3d2ccf4；保留已确认设计，未恢复被否决的第二版。
- `landing-preview-20260912`：124f569，参考源码和历史验证纳入 Git；整合冲突时保留正式采用页入口，不注册候选路由。
- `release-v0.9.13`：848b742 历史发布结果纳入，历史验证不冒充本次验证。
- `windows-signing-20260911`：用户明确删除未合入签名功能。14 个涉及文件已在本机受限目录归档并逐文件核验，恢复该工作树基线，源码状态干净。本版继续既有 Windows 构建方式，不包含此签名功能。
- 其余标签/打印及旧发版工作树均无未提交改动，提交已包含于主线。

本机凭据、依赖、安装产物和测试输出不入 Git；开发服务和工作树保留。未新增数据库迁移。

## 验证与发布状态

三端 package/lock 为 0.9.15；Android versionName 0.9.15、versionCode 123，与源码 APK 清单一致。

整合候选本机验证：前端 74 文件 / 370 测试通过；履约 5、采购规则 6、发布工具 44、客户端 31 项通过；181 个前后端权限码一致。两端 lint 无错误（前端保留 5 条既有 Fast Refresh 警告）、app TypeScript 检查、ERP/PDA Web 构建通过。独立整合审查通过，无新增迁移。

CUA 在本候选独立本地预览中确认采用版官网布局、五场景切换、0.9.15 更新摘要和真实登录入口；未登录或写开发数据，验证页已关闭。模块数据库专项证据见此前同源码回归文档；正式 CI 将重新执行同 SHA 测试与生产页面门禁。

发布已完成。业务发布提交和 tag `v0.9.15` 均为 `d3fc189e342dec2b2e07d3005ee8e7a57c7701cc`。以下均核对同一 SHA：

| 工作流 | 结果 | 运行记录 |
|---|---|---|
| Tests（13 jobs） | success | [34709047081](https://github.com/chengjianghao439/flowcube2026/actions/runs/34709047081) |
| Security Scan（5 jobs） | success | [34709047104](https://github.com/chengjianghao439/flowcube2026/actions/runs/34709047104) |
| Deploy Browser App | success | [34709047074](https://github.com/chengjianghao439/flowcube2026/actions/runs/34709047074) |
| Windows tag 正式发布 | success | [34709067739](https://github.com/chengjianghao439/flowcube2026/actions/runs/34709067739) |
| Build PDA APK | success | [34709047071](https://github.com/chengjianghao439/flowcube2026/actions/runs/34709047071) |

Windows main 验证构建 34709047128 亦成功，但它不作为正式安装包发布依据。

服务器发布日志确认所有迁移已经执行、无需新增更新，页面烟雾检查和对账回跳检查通过。经本机已配置的 `flowcube-prod` SSH 别名只读核对，前后端镜像 revision 都为上述 SHA，后端 package 版本为 0.9.15；公网 health=ok、ready=ready。此前直接 IP 未选择项目密钥的一次 SSH 失败不作为生产证明。

## 安装包核验

`/latest.json` 与 `/api/app-update/latest` 均为 0.9.15，指向版本化 Windows 安装包；GitHub Release 为正式发布、非 draft/prerelease。PDA 清单为 0.9.15 / 123、available=true。

| 产物 | 实际下载字节数 | SHA-256 |
|---|---:|---|
| Windows | 112357898 | `6b9aab7e880cc259f247c5a990da22da2508e4ae7645f75f357f48b90e2871af` |
| PDA APK | 15013526 | `1a635dea6a2f96532579fe930de248f6ee6c6066b933cde922b6a7a6dba8ee02` |

从公网完整读取文件并计算摘要，与各自清单相符。没有在本机安装 EXE/APK，也未进行真机升级、扫描或实体打印验收；Windows 继续既有未签名策略，未声称拥有代码签名或免 SmartScreen 提示。

## 收尾

所有待提交业务改动已整合进主线，签名功能按用户明确指令移除并保留本机恢复归档。主目录新增列表依赖已按 lock 安装；原开发服务保留，本次 5189 验证服务和临时浏览器页已关闭，发布工作树保持专用 codex 分支，不占用 main。

本记录为发布后纯文档补充，单独提交；业务部署及安装包证据仍以已完成全套门禁的 d3fc189 为准，不把文档提交冒充新的业务构建。
