# 极序 Flow 生产部署固定配置

这份文档的目标只有一个：以后有人说“发布新版本”，执行链路不再依赖口头记忆。

## 生产环境固定信息

- 生产浏览器地址：`http://47.93.228.251`
- 生产服务器：`root@47.93.228.251`
- 生产项目目录：`/opt/flowcube`
- 下载目录：`/opt/flowcube/backend/downloads`
- 仓库：`chengjianghao439/flowcube2026`
- 仓库内配置文件：[deploy/production.json](/Users/chengjianghao/flowcube/deploy/production.json)

## 发布原则

- `main` 是浏览器端和服务器端的唯一发布来源。
- `desktop/package.json` 的 `version` 是桌面安装包 tag 的唯一来源。
- 生产服务器信息放在仓库配置里，GitHub Actions 不再额外保存 `SERVER_HOST` / `SERVER_USER` / `SERVER_DOWNLOADS_PATH` 这类非敏感信息。
- GitHub Actions 只保留敏感项：`SSH_PRIVATE_KEY`。

## 以后怎么发布

在仓库根目录执行：

```bash
npm run release:prod
```

这个入口会做两件事：

1. `git push origin main`
   - 触发 `Deploy Browser App`
   - GitHub Actions 通过仓库内的 `deploy/production.json` 自动 SSH 到服务器
   - 在服务器执行 `SKIP_RELEASE_GATE=1 bash scripts/server-update.sh`
   - 浏览器端和服务器端更新到本次 `main` 提交

2. `npm run release:tag-desktop`
   - 自动读取 `desktop/package.json` 的 `version`
   - 推送对应 `v<version>` tag
   - 触发 `Build Desktop Installer`
   - GitHub Release 自动生成/更新安装包

## 一次性初始化

### 1. 生成 deploy key

```bash
bash scripts/setup-deploy-key.sh
```

作用：

- 在本机生成 `~/.ssh/flowcube_deploy_ed25519`
- 写入本机 SSH 别名 `flowcube-prod`
- 输出要加到服务器里的公钥

### 2. 服务器信任这把公钥

把脚本输出的公钥追加到服务器：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s\n' '<这里替换成 setup-deploy-key.sh 输出的公钥>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. GitHub Actions 配置 Secret

只需要一个：

- `SSH_PRIVATE_KEY`

填入内容：

```bash
cat ~/.ssh/flowcube_deploy_ed25519
```

### 4. 本机连通性验证

```bash
ssh flowcube-prod 'cd /opt/flowcube && git rev-parse --short HEAD'
```

## 应急发布

如果 GitHub Actions 暂时不可用，但本机 SSH 已通，可以直接：

```bash
ssh flowcube-prod 'cd /opt/flowcube && SKIP_RELEASE_GATE=1 bash scripts/server-update.sh'
```

这只更新服务器浏览器端，不会构建桌面安装包。

## 回滚

服务器应急回滚示例：

```bash
ssh flowcube-prod 'cd /opt/flowcube && git log --oneline -n 5'
ssh flowcube-prod 'cd /opt/flowcube && git reset --hard <旧提交> && docker compose up -d --build backend frontend'
```

注意：

- `git reset --hard` 属于回滚操作，只应在明确确认后执行。
- 正常情况下优先用新提交修复，不用直接硬回滚。
