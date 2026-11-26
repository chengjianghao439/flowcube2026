#!/usr/bin/env bash
# Publish the same verified Actions artifact through both release surfaces.
set -euo pipefail
version="${RELEASE_VERSION:?}"
tag="${RELEASE_TAG:?}"
source_sha="${TARGET_SHA:?}"
artifact="${DESKTOP_ARTIFACT:?}"
artifact_sha="${DESKTOP_ARTIFACT_SHA:?}"
downloads_path="${SERVER_DOWNLOADS_PATH:?}"
ssh_target="${SERVER_USER:?}@${SERVER_HOST:?}"
ssh_port="${SERVER_SSH_PORT:?}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$tag" = "v$version" ]]
[[ "$source_sha" =~ ^[a-f0-9]{40}$ && "$artifact_sha" =~ ^[a-f0-9]{64}$ ]]
[[ "$(basename "$artifact")" =~ ^[A-Za-z0-9_.-]+\.exe$ ]]

ssh_opts=(-o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20
  -o ServerAliveInterval=30 -o ServerAliveCountMax=6
  -o ControlMaster=auto -o ControlPersist=120 -o "ControlPath=${RUNNER_TEMP:?}/desktop-release-%C")
ssh_remote() {
  timeout -k 5 120 ssh "${ssh_opts[@]}" -p "$ssh_port" "$ssh_target" "$@"
}
cleanup_remote_tmp() {
  ssh_remote "rm -rf '$remote_tmp'" >/dev/null 2>&1 \
    || echo "::warning::远端中转目录清理失败，请手工检查 $remote_tmp"
  ssh -p "$ssh_port" "${ssh_opts[@]}" -O exit "$ssh_target" >/dev/null 2>&1 || true
}

github_args=(--tag "$tag" --version "$version" --source-sha "$source_sha" --sha256 "$artifact_sha" --file "$artifact")
node scripts/publish-release-asset.cjs "${github_args[@]}" --check-only 1

remote_tmp=$(ssh_remote 'umask 077; mktemp -d /tmp/flowcube-desktop-release.XXXXXXXXXX')
[[ "$remote_tmp" =~ ^/tmp/flowcube-desktop-release\.[a-zA-Z0-9]{10}$ ]] || { echo '远端暂存目录无效' >&2; exit 1; }
trap cleanup_remote_tmp EXIT
remote_artifact="$remote_tmp/$(basename "$artifact")"
remote_script="$remote_tmp/release-desktop.js"
timeout -k 5 120 scp "${ssh_opts[@]}" -P "$ssh_port" scripts/release-desktop.js "$ssh_target:$remote_script"
bash scripts/transfer-release-asset.sh "$artifact" "$ssh_target" "$ssh_port" "$remote_artifact"

ssh_remote "chmod 0644 '$remote_script' '$remote_artifact'"

server_publish() {
  local command
  printf -v command '%q ' flock -w 60 "${downloads_path}/.desktop-publish.lock" \
    docker run --rm --user node:node --entrypoint node \
    --mount "type=bind,source=$downloads_path,target=$downloads_path" \
    --mount "type=bind,source=$remote_script,target=/tmp/release-desktop.js,readonly" \
    --mount "type=bind,source=$remote_artifact,target=/tmp/$(basename "$artifact"),readonly" \
    -e "FLOWCUBE_DOWNLOADS_ROOT=$downloads_path" -e "FLOWCUBE_RELEASE_NOTES_B64=${RELEASE_NOTES_B64:-}" \
    flowcube-backend /tmp/release-desktop.js "$version" \
    "--artifact=/tmp/$(basename "$artifact")" "--source-sha=$source_sha" "--sha256=$artifact_sha" "$@"
  ssh_remote "$command"
}

server_publish --dry-run --check-write-access
if [ "${ATTACH_DESKTOP_RELEASE:-false}" = true ]; then
  node scripts/publish-release-asset.cjs "${github_args[@]}" --prepare-only 1
fi
server_publish
if [ "${ATTACH_DESKTOP_RELEASE:-false}" = true ]; then
  node scripts/publish-release-asset.cjs "${github_args[@]}" --complete-existing 1 --origin "${ERP_ORIGIN:?}"
fi
