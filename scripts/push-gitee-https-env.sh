#!/usr/bin/env bash
# 使用 Gitee HTTPS + 私人令牌推送（令牌不落盘；仅进程内存中出现）
#
#   export GITEE_USERNAME=你的Gitee用户名
#   export GITEE_TOKEN=私人令牌   # Gitee：设置 → 安全设置 → 私人令牌，勾选 projects
#   export GITEE_OWNER=chengjianghao   # 可选，默认 chengjianghao
#   export GITEE_REPO=flowcube2026     # 可选
#   bash scripts/push-gitee-https-env.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${GITEE_USERNAME:?需 export GITEE_USERNAME}"
: "${GITEE_TOKEN:?需 export GITEE_TOKEN（私人令牌）}"
OWNER="${GITEE_OWNER:-chengjianghao}"
REPO="${GITEE_REPO:-flowcube2026}"

# Gitee 要求对令牌中的特殊字符做 URL 编码；若推送失败可改用「部署公钥 SSH」方式
URL_ENC_TOKEN=$(python3 -c "import urllib.parse,os; print(urllib.parse.quote(os.environ['GITEE_TOKEN'],safe=''))")
URL="https://${GITEE_USERNAME}:${URL_ENC_TOKEN}@gitee.com/${OWNER}/${REPO}.git"

git push "$URL" main
git push "$URL" --tags
echo "=== 已推送到 https://gitee.com/${OWNER}/${REPO} （main + tags）==="
