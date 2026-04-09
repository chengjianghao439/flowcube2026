# 使用 Gitee 同步极序 Flow 代码与标签

主开发远程可为 GitHub（`origin`）；若团队或 CI 使用 **Gitee**，请将同一套提交与 **tag** 推到 Gitee，避免两端不一致。

## 1. 配置远程与认证（三选一）

### A. 仓库部署公钥（本机已有密钥时推荐）

若构建机/服务器上已有 `~/.ssh/id_ed25519_flowcube2026` 与对应 **公钥**，在 Gitee 打开本仓库：

**管理 → 部署公钥 → 添加公钥**，粘贴公钥内容，并勾选 ** writable / 可写**（否则无法 `git push`）。

然后：

```bash
git remote set-url gitee git@gitee.com:chengjianghao/flowcube2026.git
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_flowcube2026 -o IdentitiesOnly=yes" git push gitee main
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_flowcube2026 -o IdentitiesOnly=yes" git push gitee --tags
```

### B. 个人 SSH 公钥

```bash
git remote set-url gitee git@gitee.com:chengjianghao/flowcube2026.git
```

在 Gitee：**个人设置 → SSH 公钥** 添加本机 `~/.ssh/id_ed25519.pub`。

### C. HTTPS + 私人令牌（不设 SSH 时）

Gitee：**个人设置 → 安全设置 → 私人令牌**，勾选 **projects** 等写仓库权限。

```bash
export GITEE_USERNAME=你的用户名
export GITEE_TOKEN=私人令牌
bash scripts/push-gitee-https-env.sh
```

若尚未添加 remote，可先：`git remote add gitee https://gitee.com/chengjianghao/flowcube2026.git`（脚本使用内嵌 URL 推送，不依赖 remote 名）。

## 2. 同步 main 与所有标签

在项目根目录执行：

```bash
bash scripts/sync-to-gitee.sh
```

或手动：

```bash
git push gitee main
git push gitee --tags
```

发版后务必推送 **对应版本的 tag**（例如 `v0.3.41`），否则 Gitee 上看不到该发行版。

## 3. 与 GitHub 双远程的日常习惯

```bash
git push origin main
git push origin --tags
git push gitee main
git push gitee --tags
```

## 4. 桌面安装包与 `latest.json`

- **Gitee Releases**：可在 Gitee 上为该仓库创建 Release，并上传 `Jixu-Flow-Setup-*.exe`（与 GitHub Release 二选一或双发均可）。
- **服务器 `/downloads/`**：与是否用 GitHub/Gitee 无关；仍须将 `backend/downloads/latest.json` 与同名 exe 部署到线上（见 `scripts/upload-downloads-to-server.sh`、`docs/RELEASE.md`）。

若你从 **Gitee Release** 拉取安装包，请把下载直链写入自建脚本或下载说明；仓库内默认的 GitHub Release 直链示例见 `scripts/upload-downloads-to-server.sh` 中的 `DOWNLOAD_RELEASE_TAG` 说明。
