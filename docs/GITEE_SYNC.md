# 使用 Gitee 同步代码与标签

主开发远程可为 GitHub（`origin`）；若团队或 CI 使用 **Gitee**，请将同一套提交与 **tag** 推到 Gitee，避免两端不一致。

## 1. 配置远程（仅需一次）

若尚未添加 Gitee：

```bash
git remote add gitee https://gitee.com/chengjianghao/flowcube2026.git
```

更推荐为 Gitee 配置 **SSH**（免每次输入密码）：

```bash
git remote set-url gitee git@gitee.com:chengjianghao/flowcube2026.git
```

在 Gitee：**个人设置 → SSH 公钥** 添加本机 `~/.ssh/id_ed25519.pub`（或你的公钥文件）。

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
