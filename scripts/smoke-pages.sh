#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
SESSION="${PLAYWRIGHT_CLI_SESSION:-fps-$$-$RANDOM}"
BASE_URL="${PAGE_SMOKE_BASE_URL:-http://127.0.0.1}"

if [ ! -f "$PWCLI" ]; then
  echo "!! 缺少 Playwright CLI wrapper：$PWCLI" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "!! 缺少 npx，无法运行页面烟雾检查" >&2
  exit 1
fi

pw() {
  bash "$PWCLI" --session "$SESSION" "$@"
}

js_quote() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

assert_text() {
  local expected="$1"
  local forbidden="${2:-}"
  local expected_js forbidden_js
  expected_js="$(js_quote "$expected")"
  if [ -n "$forbidden" ]; then
    forbidden_js="$(js_quote "$forbidden")"
    if ! pw eval "(() => {
      const text = document.body.innerText || '';
      return text.includes($expected_js) && !text.includes($forbidden_js) && !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error');
    })()" | grep -q 'true'; then
      echo "!! 页面检查失败：期望包含 $expected，且不应包含 $forbidden" >&2
      return 1
    fi
  else
    if ! pw eval "(() => {
      const text = document.body.innerText || '';
      return text.includes($expected_js) && !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error');
    })()" | grep -q 'true'; then
      echo "!! 页面检查失败：期望包含 $expected" >&2
      return 1
    fi
  fi
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
  echo "==> 页面烟雾：登录测试账号..."
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
  if ! pw eval "location.hash.includes('/dashboard') && ((document.body.innerText || '').includes('仪表盘') || (document.body.innerText || '').includes('数据总览'))" | grep -q 'true'; then
    echo "!! 登录失败，未进入仪表盘" >&2
    exit 1
  fi
}

open_and_check() {
  local path="$1"
  local expected="${2:-}"
  local forbidden="${3:-}"
  echo "==> 页面烟雾：$path"
  local hash_js
  hash_js="$(js_quote "#$path")"
  pw eval "(location.hash = $hash_js, true)" >/dev/null
  sleep 3
  if [ -n "$expected" ]; then
    assert_text "$expected" "$forbidden"
  else
    assert_no_error_text
  fi
}

main() {
  login

  open_and_check '/reports/role-workbench' '岗位工作台'
  open_and_check '/reports/reconciliation' '对账基础版'
  open_and_check '/reports/profit-analysis' '利润 / 库存分析'
  open_and_check '/reports/approvals' '审批与提醒'
  open_and_check '/reports/wave-performance' '波次效率报表'
  open_and_check '/reports/warehouse-ops' '仓库运营看板'
  open_and_check '/reports/pda-anomaly' 'PDA 异常分析'
  open_and_check '/reports/exception-workbench' '异常工作台'
  open_and_check '/inbound-tasks/1' '收货订单'
  open_and_check '/settings/barcode-print-query?category=inbound&inboundTaskId=1&status=failed' '条码打印查询'

  if [ "${PAGE_SMOKE_SKIP_DYNAMIC:-0}" = "1" ]; then
    echo
    echo "页面烟雾检查通过"
    return 0
  fi

  read -r TOP_PATH RECON_PATH <<EOF
$(node <<'NODE'
const fs = require('fs')
const path = require('path')

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnv(path.resolve(process.cwd(), '.env'))
loadEnv(path.resolve(process.cwd(), 'backend/.env'))
const svc = require('./backend/src/modules/reports/reports.service')

async function main() {
  const wb = await svc.roleWorkbench()
  const topPath = wb?.topAlert?.path || '/reports/role-workbench'
  const recon = await svc.reconciliationReport({ type: 1, page: 1, pageSize: 20 })
  const jump = recon.list.find(item => item.sourcePath || item.receiptPath)
  const reconPath = jump?.receiptPath || jump?.sourcePath || '/reports/reconciliation'
  process.stdout.write(`${topPath}\t${reconPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
NODE
)
EOF

  echo "==> 页面烟雾：动态回跳路径 $TOP_PATH"
  open_and_check "$TOP_PATH"
  echo "==> 页面烟雾：动态回跳路径 $RECON_PATH"
  open_and_check "$RECON_PATH"

  echo
  echo "页面烟雾检查通过"
}

trap 'pw close >/dev/null 2>&1 || true' EXIT
main
