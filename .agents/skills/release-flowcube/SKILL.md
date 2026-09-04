---
name: release-flowcube
description: >-
  极序 Flow（flowcube）的正式发版流程：三端版本号同步递增、填写本版更新内容、推送 main 触发浏览器部署、
  打 v* tag 触发桌面安装包构建并发布 latest.json，从而让桌面端能检测到新版本并弹出自动更新。
  务必在用户提到「发版 / 发布新版本 / 上线新版本 / 出一版 / 桌面端检测不到更新 / 桌面端没有更新提示 /
  自动更新不弹 / 打 tag / release / 版本号要不要升 / 写更新内容 / changelog / release notes / latest.json」
  等任意场景时使用本技能——即便用户只是 push 了 main、以为这样桌面端就会更新（这正是最常见的坑）。
---

# 极序 Flow 发版流程

## 这个技能解决什么

把「让一次改动真正变成用户能装到的新版本」这件事走对。最常见的踩坑是：

> 只 `git push origin main` 就以为发版完成 → 浏览器端确实更新了，但**桌面端永远检测不到新版本**。

原因有两个，缺一不可：

1. **版本号没递增**。桌面端 `desktop/lib/updateCheck.js` 用 **semver 比较**：只有 `latest.json` 的 `version` **严格大于**当前已安装版本，才会弹「发现新版本」。版本号没变 → 不弹。
2. **没打 `v*` tag**。`latest.json` 由 `scripts/release-desktop.js` 生成发布，而它**只在 tag 推送时**由 CI（`build-desktop.yml`）调用。仅 push main 会触发桌面包「验证构建」，但**不会**更新 `latest.json`，也不会上传 GitHub Release。

所以正确发版 = **递增版本号 + 填更新内容 + push main + 打 tag**。本技能就是把这四件事按正确顺序做完。

## 发版链路速览（建立心智模型）

```
bump 三端版本 ──┐
写 release-notes ─┤
                 ├─► git push main ──► CI: Tests + Security（同 SHA）──► Deploy Browser App
                 │
                 └─► npm run release:tag-desktop（打 v<version> tag）
                        └─► CI: Build Desktop Installer（仅 tag 触发发布）
                              ├─ 构建 Windows exe（NSIS 3.0.4.1）
                              ├─ 上传 GitHub Release
                              └─ 服务器跑 release-desktop.js：
                                   读 docs/release-notes/<version>.md 作为 notes
                                   写 /var/www/flowcube-downloads/latest.json
                                     { version, url, sha256, notes, publishedAt }
                                        └─► 桌面端轮询 /api/app-update/latest
                                              semver 比对 → 弹「发现新版本」+ 显示 notes
```

记住三个事实，发版就不会错：
- **`desktop/package.json` 的 version 是 git tag 的唯一来源**，CI 会校验 `tag 去掉 v == desktop version`，不一致直接构建失败。
- **更新内容来自 `docs/release-notes/<version>.md`**（文件名就是版本号，不带 v）。没有这个文件时 CI 用一句兜底文案，桌面更新弹窗会显得很敷衍，所以请务必写。
- **main 是唯一事实源**，tag 必须指向已 push 的 main HEAD（`git-tag-check.sh` 会强制校验，工作区不干净或 HEAD 不等于 origin/main 就拒绝打 tag）。

## 发版步骤

按顺序执行。用户明确要求发版后，可沿用本次任务已确认的范围，自行选择常规 patch 版本并整理更新内容，先向用户说明再执行；不要逐步重复索要同一授权。重大兼容性变化、范围不明或用户未授权的生产操作仍需澄清。仅咨询发版流程不构成发布授权。

### 0. 前置检查
- 确认在项目根目录、当前在 `main`、工作区干净、本地 main 与 `origin/main` 一致。
  ```bash
  git rev-parse --abbrev-ref HEAD   # 应为 main
  git status --short                # 应为空
  git pull origin main
  ```
- 确认要发布的代码改动已经合并进 main（发版是给「已经在 main 上的东西」打版本，不是顺便合特性）。

### 1. 决定新版本号
- 看当前版本：`node -p "require('./desktop/package.json').version"`
- 根据已确认改动选择语义化版本；涉及兼容性或产品决策时与用户确认：
  - **patch**（0.4.7 → 0.4.8）：bug 修复、小改动、不影响用法；用户已授权发布修复时可直接选用，并告知版本号。
  - **minor**（0.4.7 → 0.5.0）：新增功能、向后兼容。
  - **major**：不兼容的大改（本项目目前都在 0.x，谨慎）。
- 默认建议 patch，除非这一版有明显的新功能。

### 2. 三端版本号同步递增
用本技能自带脚本一次性把 backend / frontend / desktop 三端 `package.json` + `package-lock.json` 设成同一个版本（手改三个文件极易漏 lock 或漏某一端）：
```bash
bash .agents/skills/release-flowcube/scripts/bump-version.sh <version>
```
> 为什么三端一起升：版本号是系统整体标识，后端 `/health`、桌面关于页、桌面更新都各读各自 package.json；三端不一致会让「线上到底是哪一版」难以排查。root `package.json` 没有 version 字段，无需改。
> **脚本是幂等的**（2026-08-26 修复）：真换版本（versionName 变化）才递增 PDA `versionCode`；同一版本重跑（如写 notes 后想补 PDA 更新说明）不会重复 +1、不会虚刷新 `publishedAt`。**推荐顺序：先写第 3 步的 notes 再跑本脚本**，PDA 更新说明第一次就写入；顺序颠倒也没关系，写完 notes 后重跑是安全的。

### 3. 写本版更新内容
创建 `docs/release-notes/<version>.md`（文件名是纯版本号，**不带 v**）。这就是桌面端更新弹窗里用户看到的「更新内容」。沿用现有风格：`# v<version>` 标题 + 分类小节。

**模板：**
```markdown
# v<version>

## 新功能
- ……

## 修复
- ……

## 说明
- ……（可选，例如「桌面端与上版一致，仅随系统同步版本号」）
```
写给**最终用户**看，讲「他们能感知到的变化」，不要堆砌内部重构术语。

### 4. 提交并推送 main（触发浏览器部署）
```bash
# 先核对本次任务的所有改动，再逐路径暂存。不能把不明来源的旧改动一并纳入。
git status --short
# git add -- 已核对的具体文件路径（业务改动与对应文档一起；通用技能另行提交）
git diff --cached --stat
git diff --cached --check
git commit -m "release: 发布 v<version> — <一句话主题>"
git push origin main
```
push 后 `Deploy Browser App` 等待实际发布 SHA 的 Tests 与 Security Scan 成功，由 GitHub runner 构建 Linux amd64 镜像，再在生产部署锁内核对归档摘要/镜像 SHA、加载、迁移、切换和验证。禁止在生产机重新编译。检查失败/取消/超时不能发布；健康或页面门禁失败统一回退旧应用镜像，数据库迁移不回滚。

### 5. 打 tag（触发桌面构建 + 发布 latest.json）
```bash
npm run release:tag-desktop
```
这会跑 `release-desktop-tag.sh`：校验工作区/HEAD、确认远程无同名 tag、用 `desktop/package.json` 的版本生成 `v<version>` 并推送。tag 一推，`Build Desktop Installer` 启动，构建 exe → 上传 Release → 服务器发布 `latest.json`（带上一步写的 notes）。

### 6. 验证
- CI：`gh run list --branch main --limit 6`，确认同一 SHA 的 `Deploy Browser App`、`Tests`、`Security Scan`、`Build Desktop Installer` 都 success。PDA 还需同 SHA 浏览器部署成功后才上传已验证 APK。
- latest.json 已更新到新版本：
  ```bash
  curl -s https://<生产域名>/latest.json
  curl -s https://<生产域名>/api/app-update/latest
  ```
  应看到 `version` = 新版本、`notes` = 你写的更新内容、`url` 指向 `/versions/v<version>/...`。
- 桌面端：在比新版本旧的客户端上启动，应弹「发现新版本 <version>」并显示更新内容。

## 排查：桌面端检测不到更新

按这个顺序定位（多数情况是前两条）：

1. **版本号没升**：`latest.json` 的 version 必须 **>** 桌面端 `app.getVersion()`。两者相同 → 不弹。最常见。
2. **没打 tag**：只 push 了 main。`Build Desktop Installer` 即使因 push main 跑过，也**不发布 latest.json**。补打 tag：`npm run release:tag-desktop`。
3. **CI 构建失败**：`gh run list` 看 `Build Desktop Installer` 是否 success；失败常见于 tag 与 `desktop/package.json` 不一致、或 NSIS 校验失败。
4. **latest.json 没更新**：`curl /latest.json` 看 version 是否真的变了。没变说明服务器发布步骤没跑（多半是 SSH/部署配置缺失，看该 run 日志）。
5. **桌面端侧诊断**：在桌面端设 `FLOWCUBE_UPDATE_DIAG=1` 启动，会强制走一次检查并把接口返回、解析出的下载地址全部打日志 + 弹窗，用于定位是「没拿到 manifest」还是「版本判断没过」还是「下载地址无效」。调试还可用 `FORCE_UPDATE=1` 跳过版本比较强制弹窗。

## 回滚

发完发现这一版有问题、要把桌面更新指回上一版：
```bash
# 在服务器上（容器内），把 latest/current 指针重写回某个历史版本
node scripts/release-desktop.js <旧version> --rollback
```
历史版本仍保留在 `/versions/v<x.y.z>/`，回滚只改 `latest.json` 与 `current/` 指针，不删历史包。

## 关键约束（别违反）

- 桌面手动 `checkout_ref` 发布以实际 `git rev-parse HEAD` 验证同 SHA 检查，输入版本必须匹配检出 package；不能借用运行界面的 main SHA 绿灯。
- PDA 发布通过 `scripts/publish-pda.sh` 写唯一 APK 后原子切换 `backend/apk/published-version.json`；源码 version.json 只表示目标版本，不能先改生产清单再上传包。发布只更新挂载目录，不重置 Git 或重建后端。
- 客户端需要可信 HTTPS 清单和 sha256，下载后及安装前均验摘要；移除了按 IP 放行任意证书的旧逻辑。无摘要/证书错误需修正发布源后再更新。

- **桌面正式包只能由 GitHub Actions 的 Windows runner 构建**。本机 Mac 的 `makensis` 可能被污染，打出的 exe 在部分 Windows 上「双击无反应」。本机只用于开发调试。
- **不要手工复制 exe 到发布目录**。必须经 `release-desktop.js`，它负责生成 `metadata.json` / `latest.json` / `current/version.txt` 并强制 `latest.json` 指向 `/versions/`。
- **tag 不可复用**：同一版本号的 tag 已存在就不能再发，必须升版本。`release-desktop-tag.sh` 会拦截重复 tag。

完整背景见 `docs/RELEASE.md`。
