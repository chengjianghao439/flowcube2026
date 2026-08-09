#!/bin/sh
# 后端容器入口（P2-13 非 root）：
# 1. 以 root 启动，把挂载的可写目录 chown 给 node 用户（宿主挂载目录默认 root 所有）
# 2. 降权到 node 用户运行业务进程——业务进程本身不持有 root 权限
#
# 容器默认行为：node index.js（compose 起后端）。
# 显式传参（docker run flowcube-backend node /release-scripts/release-desktop.js ...）：
#   执行传入的命令。桌面发布 CI 依赖这个覆盖——若这里写死 index.js，
#   Publish EXE 步骤会被入口拦截改跑业务进程，而业务进程 require config/env.js
#   强校验 JWT_SECRET（发布容器不注入），导致 release-desktop.js 永远发不出去。
set -e

# 可写挂载点（桌面更新发布目录等）；chown 失败不阻断（目录不存在时跳过）
chown -R node:node /var/www/flowcube-downloads 2>/dev/null || true

if [ "$#" -gt 0 ]; then
  # 显式命令：以 node 用户执行（如 CI 的 release-desktop.js）。用 su-exec 传原始命令
  # 而非 "node index.js" 拼接，保证任意传入命令都能跑。
  exec su-exec node:node "$@"
fi

exec su-exec node:node node index.js
