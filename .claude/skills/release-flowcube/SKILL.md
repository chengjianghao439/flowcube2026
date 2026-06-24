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
                 ├─► git push main ──► CI: Deploy Browser App ──► 浏览器端立即更新
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

按顺序执行。每一步都先向用户确认关键决策（新版本号、更新内容），发版是对外动作，不要替用户臆断。

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
- 与用户确认升哪一位（语义化版本）：
  - **patch**（0.4.7 → 0.4.8）：bug 修复、小改动、不影响用法。
  - **minor**（0.4.7 → 0.5.0）：新增功能、向后兼容。
  - **major**：不兼容的大改（本项目目前都在 0.x，谨慎）。
- 默认建议 patch，除非这一版有明显的新功能。

### 2. 三端版本号同步递增
用本技能自带脚本一次性把 backend / frontend / desktop 三端 `package.json` + `package-lock.json` 设成同一个版本（手改三个文件极易漏 lock 或漏某一端）：
```bash
bash .claude/skills/release-flowcube/scripts/bump-version.sh <version>
```
> 为什么三端一起升：版本号是系统整体标识，后端 `/health`、桌面关于页、桌面更新都各读各自 package.json；三端不一致会让「线上到底是哪一版」难以排查。root `package.json` 没有 version 字段，无需改。

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
git add .
git commit -m "release: 发布 v<version> — <一句话主题>"
git push origin main
```
push 后 `Deploy Browser App` 会自动把浏览器端部署到生产。

### 5. 打 tag（触发桌面构建 + 发布 latest.json）
```bash
npm run release:tag-desktop
```
这会跑 `release-desktop-tag.sh`：校验工作区/HEAD、确认远程无同名 tag、用 `desktop/package.json` 的版本生成 `v<version>` 并推送。tag 一推，`Build Desktop Installer` 启动，构建 exe → 上传 Release → 服务器发布 `latest.json`（带上一步写的 notes）。

### 6. 验证
- CI：`gh run list --branch main --limit 6`，确认 `Deploy Browser App`、`Tests`、`Build Desktop Installer` 都 success。
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

- **桌面正式包只能由 GitHub Actions 的 Windows runner 构建**。本机 Mac 的 `makensis` 可能被污染，打出的 exe 在部分 Windows 上「双击无反应」。本机只用于开发调试。
- **不要手工复制 exe 到发布目录**。必须经 `release-desktop.js`，它负责生成 `metadata.json` / `latest.json` / `current/version.txt` 并强制 `latest.json` 指向 `/versions/`。
- **tag 不可复用**：同一版本号的 tag 已存在就不能再发，必须升版本。`release-desktop-tag.sh` 会拦截重复 tag。

完整背景见 `docs/RELEASE.md`。
