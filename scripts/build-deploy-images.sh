#!/usr/bin/env bash
# 在 GitHub runner 构建，生产 server-update.sh 不调用本脚本。
set -euo pipefail
cd "$(dirname "$0")/.."
sha="${GITHUB_SHA:-}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] && [ "$(git rev-parse HEAD)" = "$sha" ] || { echo '!! 构建 SHA 不匹配' >&2; exit 1; }
[ "${GITHUB_ACTIONS:-}" = true ] || { echo '!! 应用发布镜像只在 GitHub Actions 构建' >&2; exit 1; }
archive="${DEPLOY_IMAGE_OUTPUT:?DEPLOY_IMAGE_OUTPUT is required}"
case "$archive" in /*) ;; *) echo '!! 归档路径必须为绝对路径' >&2; exit 1 ;; esac
trap 'rm -f "$archive.partial"' EXIT
for service in backend frontend; do
  docker build --platform linux/amd64 --label "org.opencontainers.image.revision=$sha" \
    -f "Dockerfile.$service" -t "flowcube-$service:$sha" .
done
docker save "flowcube-backend:$sha" "flowcube-frontend:$sha" | gzip -1 > "$archive.partial"
mv "$archive.partial" "$archive"
sha256sum "$archive"
