# PDA 安装包发布一致性修复（2026-09-04）

本文件记录工作区实现与本次验证，不代表已提交、已推送或已部署。总审计和 AGENTS.md 由主任务合并同步。

## 现行发布契约

`backend/apk/version.json` 仍是受 Git 管理的构建输入，必须与 Android 的 versionName/versionCode 同步。服务器实际发布事实使用不受 Git 管理的 `backend/apk/published-version.json`；API 优先读取它，仅在该文件不存在时兼容旧 `version.json`。已部署清单损坏、为符号链接、路径非法或摘要不匹配时不能回退到源码清单。

发布入口：

```bash
bash scripts/publish-pda.sh <apk-path> <version-json-path> <publish-dir>
```

需要 Bash、Python 3 标准库和本地文件系统的原子 rename/link。调用方继续持有统一部署锁；脚本额外取得发布目录 `.publish-pda.lock` 的非阻塞文件锁，独立并发调用会失败。脚本不修改 Git 版本清单、不重建或重启服务。

发布顺序为：校验输入 → 将 APK 复制到发布目录临时文件并计算真实摘要 → 独占安装 `FlowCubePDA-<versionCode>-<sha256>.apk` → 写入完整临时清单 → 原子替换 `published-version.json`。文件及目录显式 fsync；清单切换前发生失败，旧清单和旧 APK 继续有效。若进程被强制终止，可能留下未引用的临时文件或不可变 APK，不会让旧清单指向新包。普通异常清理临时文件；旧 APK 不自动删除，以保留正在进行的下载。

相同 versionCode、版本号、摘要的重复发布幂等，不改写已发布清单或发布时间；同号不同包/版本号、版本回退、空 APK、清单摘要或大小不一致均拒绝。输入和目标 APK 只允许普通文件；清单内 filename 必须是单个安全文件名，不允许路径穿越。versionCode 为 1 至 2147483647 的整数。脚本校验清单与文件字节一致性；APK 内嵌版本号和签名仍由构建工作流验证。

## 首次迁移与部署调用方

已有固定 `app-release.apk` 的服务器应在首次 `git reset` **之前**，持统一部署锁，以旧 `version.json` 与旧 APK 调用上述脚本，建立旧发布的不可变快照；随后拉取新源码也不会提前公布新 PDA 版本。旧服务器可能没有本脚本，首次迁移必须从本次受检 checkout 上传脚本，或使用等效的旧发布快照逻辑。不能先 reset 后再根据新 Git 清单解释旧 APK。

若调用方仅复制旧清单为 `published-version.json`，服务兼容无摘要、固定文件名的旧清单；下一次脚本发布会建立新版本的不可变包。推荐首次迁移直接使用本脚本，保证迁移前取得的旧下载地址也能继续访问旧不可变文件。

以下部署状态不应受 Git 管理：

- `backend/apk/published-version.json`
- `backend/apk/.publish-pda.lock`
- `backend/apk/.publish-pda-*`
- `backend/apk/*.apk`（既有忽略规则）

浏览器部署和 PDA workflow 的接线、统一部署锁、首次迁移、回滚及 AGENTS.md 第 10/12 节和发版技能的现行说明由主任务同步。不得再执行先替换固定 APK、再替换 Git `version.json` 的旧发布流程。

## 下载语义

版本 API 返回真实 APK 的 sha256、大小和含 versionCode/sha256 的下载地址。下载端用这两项定位不可变文件；当前清单升级后，旧地址仍返回旧 APK。无摘要的旧地址如果指定了不同 versionCode，会返回 409 要求刷新，不能返回另一版本的文件。

旧环境固定文件地址仍可使用，但必须通过请求摘要核对。摘要缓存按文件路径、inode、大小、mtime 和 ctime 区分，避免相同时间戳的不同 APK 误用摘要。清单及 APK 禁止追随符号链接。

## 本次验证

`node --test tests/audit-pda-publish.test.js`：原行为 RED 为 4 passed / 6 failed；实现后包含追加迁移及路径回归共 **13 passed / 0 failed**。测试执行真实发布脚本、真实临时目录和实际服务源码；仅把服务的部署目录定位到临时树，无数据库、生产环境或网络访问。

覆盖首次发布、旧固定包迁移、同号重复发布、同号异包/回退拒绝、非法输入、目录文件锁、符号链接、Git 版本提前变化、旧环境回退、清单损坏、摘要缓存和旧下载 URL。`bash -n scripts/publish-pda.sh` 与 PDA 服务 eslint 通过。

剩余部署验证：未在生产文件系统执行；未构建/安装 Android APK 或做真机下载验证；Windows/Android 网络、系统安装器与证书行为不由这些目录测试证明。原子可见性由同目录 link/rename 和保留旧文件实现，未模拟物理断电。
