# v0.9.20 发布结果（2026-09-18）

## 结论

| 项 | 值 |
|---|---|
| 发布提交 | `976a08ad8ff8537ea83da3c51e196f14f830403f`（main = origin/main） |
| tag | `v0.9.20`（指向同一提交） |
| 三端版本 | backend / frontend / desktop = `0.9.20` |
| PDA | `versionName 0.9.20` / `versionCode 128` |
| 桌面更新清单 | `/latest.json` = 0.9.20，`publishedAt` 2026-09-17T16:59:56Z |
| GitHub Release | `FlowCube ERP 0.9.20`（Latest，含 `FlowCube-Setup-0.9.20.exe`） |

本版内容（用户可见）见 [release-notes/0.9.20.md](release-notes/0.9.20.md)；技术改动与逐项验证见
[acceptance-issues-fix-2026-09-17.md](acceptance-issues-fix-2026-09-17.md) 与
[pda-scan-default-mode-2026-09-17.md](pda-scan-default-mode-2026-09-17.md)。

## 同 SHA 门禁

`976a08a` 上四个工作流全部 success：`Tests`、`Security Scan`、`Deploy Browser App`、
`Build Desktop Installer`（push main 的验证构建）。PDA 因下述原因在该 SHA 上补跑
`workflow_dispatch`，同样 success（含「等本提交浏览器部署成功」与发布后版本端点校验）。

## 产物核验

| 产物 | 核验方式 | 结果 |
|---|---|---|
| 桌面 exe | `curl /latest.json`：`url=/versions/v0.9.20/FlowCube-Setup-0.9.20.exe`、sha256 `f907887a…`；下载该 URL 复算 sha256 | 一致，112,361,165 字节 |
| GitHub Release | `gh release view v0.9.20` | 非草稿、Latest、附件 `FlowCube-Setup-0.9.20.exe`（112,361,165 字节，uploaded） |
| PDA APK | `/api/pda/version` 返回 0.9.20 / 128 / sha256 `c13806ac…`；下载 `/api/pda/download` 复算 | 一致，15,017,173 字节 |
| 生产健康 | `/api/health`、`/api/ready`、首页 | 200 / ok |

## 过程中的三个环境问题与处置

### 1. 首轮 Tests 失败：两条旧断言与本次有意的行为变更冲突

失败项：`smoke:warehouse-assets-waves`（期望 `code = CONFLICT`）与 `smoke:warehouse-scope`
（`别人仓的盘点单详情被拒 — status=500`）。前者断言的正是本次移除的通用码兜底；后者是新
「空仓不允许建盘点单」规则让用例在空仓建单失败、拿到 `NaN` 再请求 `/api/stockcheck/NaN`。
都在 `976a08a` 修正测试夹具/期望，未回退任何业务规则，明细见
`docs/acceptance-issues-fix-2026-09-17.md` 第十一节。两个 smoke 已在本地测试库复跑通过
（warehouse-scope 43/43；warehouse-assets-waves 200 断言 + cleanup 校验）。

### 2. 后续提交不会触发 PDA 构建；生产 PDA 长期落后

`Build PDA APK` 的 push 触发带路径过滤（`frontend/**`、`backend/apk/version.json` 等）。
只动测试与文档的第二次提交不在过滤范围内，因此最终发布 SHA 上没有 PDA 构建；而首次提交
`8122d6d` 的 PDA 构建因当时浏览器部署失败而失败。

**更重要的历史欠账**：`v0.9.19` 的 PDA 发布从未成功（`52ff39b` failed、`ebff27f` cancelled），
所以本版发布前生产 `/api/pda/version` 仍停在 **0.9.18 / versionCode 126**。

处置：在最终 SHA 上 `gh workflow run build-pda-apk.yml --ref main` 补跑，发布成功，
生产 PDA 清单追平到 0.9.20 / 128。

**加固（同日落地）**：① 该工作流新增 `checkout_ref` 输入，并以**实际检出的提交**作为
「等浏览器部署 / 服务器 HEAD 校验」的基准（此前只看 `github.sha`，补跑一旦落在后续的
文档提交上就会等一个永不出现的部署）；② `scripts/wait-release-checks.js` 对「该提交根本
没有对应运行」在约 5 分钟内快速失败并提示指定发布提交，不再空等 30 分钟；③ 新增
`npm run release:verify -- --origin https://<生产域名>` 逐项核对线上三端版本，
**PDA 落后即视为发版未完成**——这正是本次能发现 v0.9.19 欠账的检查。

④ 工作流再加 `preflight` 前置门（构建前判定）：版本清单不一致直接快失败；目标版本**已发布**
则整条构建跳过。触发加固的直接原因是本次推 workflow 改动时 PDA 构建又红了——它按同一
versionCode 生成了不同字节的 APK，被 `publish-pda.sh` 的「同一 versionCode 不能对应不同
版本或安装包」守卫拒绝。该守卫本身是对的（客户端不会因同 versionCode 更新），但"发版后再动
`frontend/**` 就白构建 4 分钟再红"属于噪音，前置门把这类运行变成明确的跳过。

### 3. 桌面 tag 发布的「Upload EXE to Release」在 Windows runner 上挂起（连续两次）

现象：`Build Desktop Installer`（tag `v0.9.20`）在 `Upload EXE to Release` 步骤停滞 15 分钟以上
且无日志输出；同一仓库 v0.9.18 的同样步骤上传同一个约 112 MB 的 exe 只用了 **10 秒**。
两次运行（首次与取消后的重跑）都在同一步卡住，期间 `githubstatus.com` 显示 All Systems Operational。
同一份 exe 从本机 `gh release upload` 上传仅需约 52 秒，说明不是包本身或权限问题。

影响面：**面向用户的更新链路不受影响**——`latest.json` 与服务器 `/versions/v0.9.20/` 由挂起步骤
**之前**的「Publish EXE to canonical download directory」写入并已成功；挂住的只是 GitHub Release 附件。

**根因（当日用新脚本复现）**：GitHub 附件存储会间歇性返回
`HTTP 500 {"message":"Error saving asset"}`——本地复现时连续两次 500、第三次成功。
`gh release upload` 对这种瞬时错误既不超时、也不重试、也不报告，表现就是"卡住"。

处置：

1. 取消挂起的 run（`concurrency: flowcube-server-deploy` 因此释放，排队的 PDA 补跑得以执行）；
2. 从服务器正式下载路径取回 **CI 构建的同一份 exe**，复算 sha256 与 `/latest.json` 声明一致
   （`f907887a…`）——**没有在本机重新构建**，也没有把本机构建物写进发布目录；
3. `gh release upload v0.9.20 <file> --clobber` 补传附件；
4. 发现挂起中断的 `gh release create` 留下的是**草稿** Release（这就是前面 `gh release view`
   能看到 Release 却没有任何附件的原因），用 `gh release edit v0.9.20 --draft=false
   --title "FlowCube ERP 0.9.20" --latest` 正式发布。

**加固（同日落地，随下一次发版生效）**：该步骤改用 `scripts/publish-release-asset.cjs`，
流程为「确保 Release 存在（缺则建草稿）→ 删同名附件 → 默认 5 次尝试、每次 10 分钟超时、
失败 10 秒后重试 → 校验远端附件大小 → 才 `draft=false` + latest」；中断只会留下可见的草稿
和明确日志，不会出现"看起来发布了却没有包"。脚本已在真实仓库验证：用临时附件名对
v0.9.20 走完整流程，前两次 500、第三次成功，校验与转正正常，验证附件随后删除，
正式附件与 latest.json 保持不变。

遗留：该 run 被取消，其 Actions artifact（桌面 exe 与 `flowcube-pda-apk` 的冗余备份）没有上传。
正式产物仍在服务器下载目录与 GitHub Release 上，不影响更新与分发。

**不要再重跑 `v0.9.20` 的 tag 构建**：Windows 打包不是逐字节可复现的，重跑会生成另一份 exe 并
用新的 sha256 覆盖 `/latest.json` 与 `/versions/v0.9.20/`，而 GitHub Release 上的附件仍是本次
补传的旧字节，两边摘要就会对不上。若要补齐 Actions 构件备份，等下一次正常发版即可。

## 未验证 / 下一轮

- **真机与物理环境**：Android PDA 实际安装本版 APK、扫描头不弹软键盘的现场效果、相机扫码、
  真实打印机出纸，均需现场验收；本地只能证明「不渲染/不聚焦输入框」与构建产物正确。
- **桌面端更新弹窗**未在「低于 0.9.20 的真实客户端」上启动确认；清单、sha256 与下载端点已按
  上面的方式核对。
- 生产多模块只读抽查、退货质检扫码入口静默忽略、改单确认、批次拣货波次、出库确认 + 物流运单 +
  应收闭环、审批流、多角色权限视角等仍未闭环，延续 `docs/acceptance-issues-fix-2026-09-17.md`
  第十节列出的清单。
