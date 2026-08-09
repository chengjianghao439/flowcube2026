#!/bin/sh
# 后端容器入口（P2-13 非 root）：
# 1. 以 root 启动，把挂载的可写目录 chown 给 node 用户（宿主挂载目录默认 root 所有）
# 2. 降权到 node 用户运行业务进程——业务进程本身不持有 root 权限
set -e

# 可写挂载点（桌面更新发布目录等）；chown 失败不阻断（目录不存在时跳过）
chown -R node:node /var/www/flowcube-downloads 2>/dev/null || true

exec su-exec node:node node index.js
