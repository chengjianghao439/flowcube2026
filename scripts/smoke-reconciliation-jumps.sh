#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SESSION="${PLAYWRIGHT_CLI_SESSION:-rj-$$-$RANDOM}"
BASE_URL="${PAGE_SMOKE_BASE_URL:-http://127.0.0.1}"

if command -v npm >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(npm exec --yes --package @playwright/cli -- playwright-cli)
elif command -v npx >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(npx --yes --package @playwright/cli playwright-cli)
else
  echo "!! 缺少 npm / npx，无法运行对账回跳烟雾检查" >&2
  exit 1
fi

pw() {
  "${PLAYWRIGHT_RUNNER[@]}" --session "$SESSION" "$@"
}

js_quote() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

assert_no_error_text() {
  if ! pw eval "(() => {
    const text = document.body.innerText || '';
    return !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error');
  })()" | grep -q 'true'; then
    echo "!! 页面检查失败：发现渲染错误或未注册提示" >&2
    return 1
  fi
}

login() {
  echo "==> 对账回跳：登录测试账号..."
  local auth_json token user_json auth_storage auth_storage_js
  auth_json="$(curl -fsS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')"
  token="$(node -e 'const res = JSON.parse(process.argv[1]); process.stdout.write(res.data.token)' "$auth_json")"
  user_json="$(node -e 'const res = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(res.data.user))' "$auth_json")"
  auth_storage="$(node -e 'const token = process.argv[1]; const user = JSON.parse(process.argv[2]); process.stdout.write(JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }))' "$token" "$user_json")"
  auth_storage_js="$(js_quote "$auth_storage")"

  pw open "$BASE_URL/#/login" >/dev/null
  pw eval "(sessionStorage.setItem('flowcube-auth-v3', $auth_storage_js), true)" >/dev/null
  pw eval "(location.reload(), true)" >/dev/null
  sleep 3
  if ! pw eval "location.hash.includes('/dashboard')" | grep -q 'true'; then
    echo "!! 登录失败，未进入仪表盘" >&2
    exit 1
  fi
}

open_path() {
  local path="$1"
  local label="$2"
  echo "==> 对账回跳：$label -> $path"
  local hash_js
  hash_js="$(js_quote "#$path")"
  pw eval "(location.hash = $hash_js, true)" >/dev/null
  sleep 3
  assert_no_error_text
}

fetch_jump_paths() {
  node <<'NODE'
const BASE_URL = process.env.PAGE_SMOKE_BASE_URL || 'http://127.0.0.1'

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  return res.json()
}

async function fetchType(token, type) {
  const res = await fetch(`${BASE_URL}/api/reports/reconciliation?type=${type}&page=1&pageSize=20`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`reconciliation ${type} failed: ${res.status}`)
  const json = await res.json()
  const rows = json?.data?.list ?? []
  const row = rows.find(item => item.sourcePath || item.receiptPath)
  if (!row) throw new Error(`reconciliation ${type} has no jumpable row`)
  return {
    type,
    sourcePath: row.sourcePath || '',
    receiptPath: row.receiptPath || '',
  }
}

async function main() {
  const auth = await login()
  const token = auth.data.token
  const jumps = []
  for (const type of [1, 2]) {
    jumps.push(await fetchType(token, type))
  }
  process.stdout.write(JSON.stringify(jumps))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
NODE
}

main() {
  login

  open_path '/reports/reconciliation' '对账基础版'

  local jump_json
  jump_json="$(fetch_jump_paths)"

  node -e '
const jumps = JSON.parse(process.argv[1])
for (const jump of jumps) {
  console.log(`==> 对账回跳：type ${jump.type}`)
  if (jump.sourcePath) console.log(`source\t${jump.sourcePath}`)
  if (jump.receiptPath) console.log(`receipt\t${jump.receiptPath}`)
}
' "$jump_json"

  while IFS=$'\t' read -r kind path; do
    [ -n "${path:-}" ] || continue
    open_path "$path" "对账回跳 ${kind}"
  done < <(
    node -e '
const jumps = JSON.parse(process.argv[1])
for (const jump of jumps) {
  if (jump.sourcePath) console.log(`source\t${jump.sourcePath}`)
  if (jump.receiptPath) console.log(`receipt\t${jump.receiptPath}`)
}
' "$jump_json"
  )

  echo
  echo "对账回跳烟雾检查通过"
}

trap 'pw close >/dev/null 2>&1 || true' EXIT
main
