# v0.9.18 发布结果（2026-09-17）

**三端版本**：0.9.18（PDA versionCode 126）
**发布 SHA**：`1eec31fa`
**发布方式**：push main + `npm run release:tag-desktop`（tag `v0.9.18`）

## 本版内容

- **修复**：操作日志页此前要串行拉全表（3.8 万条 → 190+ 次请求、几十秒），表现为「查询不到东西」。
  现为「自动取齐」设 5000 行上限并返回 `truncated` 标记，页面提示用户缩小范围。
- **改进**：各页面查询弹窗显示当前实际生效的日期范围（此前为空白，看不出列表已被筛选）；
  销售、采购、收货、库存流水、操作日志等页面统一该口径；增长快的数据表补默认时间窗口。

## 产物核验

| 端 | 结果 |
|---|---|
| 浏览器 | `Deploy Browser App` success；服务器已 reset 到 `1eec31fa`；`/api/ready` 返回 200 |
| 桌面 | `Build Desktop Installer` success；`latest.json` 与 `/api/app-update/latest` 均为 **0.9.18**；安装包 `/versions/v0.9.18/FlowCube-Setup-0.9.18.exe` 可下载（HTTP 200，112,359,018 字节） |
| PDA | `Build PDA APK` success；`/api/pda/version` 返回 **0.9.18 / versionCode 126** + 本版更新说明 + 下载链接 |

同 SHA 的 `Tests`、`Security Scan` 均为 success。

## 发布过程中的三次环境问题（均非代码问题，已逐个处置）

1. **Tests 环境抖动**：冒烟测试在 login 阶段报 `TypeError: fetch failed [cause]: bad port`——连不上自己刚起的临时服务。
   同批次其他 SHA 的 Tests 正常，判定为环境抖动；**重跑即通过**。
2. **Deploy 被 cancelled**：push 与随后的 tag 触发的部署在同一 concurrency group 内相互取代。
   cancelled 的运行无法 rerun，改用 `gh workflow run deploy-browser.yml --ref main` 手动触发，成功。
3. **PDA 构建被取消**：原因同上，且它的门禁要求「等浏览器部署成功」。
   用 `gh workflow run build-pda-apk.yml --ref main` 手动触发，成功。

> 这三条共同说明：**发版时 push main 与打 tag 之间要留足间隔**，等前一个部署真正跑完再进入下一步；
> 万一被取消，用 `workflow_dispatch` 补触发（cancelled 的运行不能 rerun）。

## 待观察

- `bump-version.sh` **连续两次**（v0.9.17、v0.9.18）报告 `backend/apk/version.json` 的 versionCode 比
  `frontend/android/app/build.gradle` 小 1 并由脚本自动对齐。说明脚本之外还有环节在单独递增
  build.gradle 的 versionCode——**下次发版前值得查清来源**，否则 versionCode 会持续多算一位。
