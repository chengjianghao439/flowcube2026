#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SESSION="${PLAYWRIGHT_CLI_SESSION:-fps-$$-$RANDOM}"
BASE_URL="${PAGE_SMOKE_BASE_URL:-http://127.0.0.1}"

if command -v npm >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(npm exec --yes --package @playwright/cli -- playwright-cli)
elif command -v npx >/dev/null 2>&1; then
  PLAYWRIGHT_RUNNER=(npx --yes --package @playwright/cli playwright-cli)
else
  echo "!! 缺少 npm / npx，无法运行页面烟雾检查" >&2
  exit 1
fi

pw() {
  "${PLAYWRIGHT_RUNNER[@]}" --session "$SESSION" "$@"
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
  open_and_check '/warehouse-tasks' '仓库任务'
  open_and_check '/picking-waves?waveId=1&focus=print-closure' '出库打印闭环'
  open_and_check '/inbound-tasks/1' '收货订单'
  open_and_check '/purchase/1'
  open_and_check '/sale/1'
  open_and_check '/customers' '客户管理'
  open_and_check '/suppliers' '供应商管理'
  open_and_check '/payments'
  open_and_check '/inventory'
  open_and_check '/stockcheck'
  open_and_check '/settings/barcode-print-query?category=inbound&inboundTaskId=1&status=failed'
  open_and_check '/settings/barcode-print-query?category=outbound&status=failed'
  open_and_check '/settings/barcode-print-query?category=logistics&status=failed'

  echo
  echo "页面烟雾检查通过"
}

trap 'pw close >/dev/null 2>&1 || true' EXIT
main
