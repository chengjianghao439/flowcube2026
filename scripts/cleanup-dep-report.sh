#!/usr/bin/env bash
# ============================================================
# FlowCube 无用依赖与版本对齐报告
# 只读模式 — 报告未使用的依赖和版本差异
#
# 使用：
#   bash scripts/cleanup-dep-report.sh
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPORT="$ROOT/.dep-cleanup-report-$(date +%Y%m%d-%H%M%S).txt"
SUMMARY_FILE="$ROOT/.dep-cleanup-summary-$(date +%Y%m%d).txt"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

{
  echo "============================================"
  echo " FlowCube 依赖清理报告"
  echo " 生成时间: $(date)"
  echo "============================================"
  echo ""
} > "$REPORT"

# ── 1. 版本对齐检查 ─────────────────────────────────────────
log "[1/4] 检查三端版本对齐..."
{
  echo "===== 1. 三端 package.json 版本号 ====="
} >> "$REPORT"

for pkg in "backend" "frontend" "desktop"; do
  ver=$(node -p "require('./$pkg/package.json').version" 2>/dev/null || echo "N/A")
  echo "  $pkg: $ver" >> "$REPORT"
done

{
  echo ""
  echo "===== 2. 同名依赖版本不一致 ====="
} >> "$REPORT"

node -e "
const pkgs = {
  backend: require('./backend/package.json'),
  frontend: require('./frontend/package.json'),
  desktop: require('./desktop/package.json')
};
const allDeps = new Set();
for (const [name, pkg] of Object.entries(pkgs)) {
  for (const [dep, ver] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) {
    allDeps.add(dep);
  }
}
let found = false;
for (const dep of [...allDeps].sort()) {
  const versions = {};
  for (const [name, pkg] of Object.entries(pkgs)) {
    const v = (pkg.dependencies && pkg.dependencies[dep]) || (pkg.devDependencies && pkg.devDependencies[dep]);
    if (v) versions[name] = v;
  }
  if (Object.keys(versions).length > 1) {
    const vals = [...new Set(Object.values(versions))];
    if (vals.length > 1) {
      console.log('⚠️  ' + dep + ' -> ' + JSON.stringify(versions));
      found = true;
    }
  }
}
if (!found) console.log('✅ 所有三端同名依赖版本一致');
" >> "$REPORT" 2>/dev/null

# ── 2. 依赖体积分析 ─────────────────────────────────────────
log "[2/4] 分析依赖体积..."
{
  echo ""
  echo "===== 3. 后端最大依赖 (>5MB) ====="
} >> "$REPORT"
if [ -d "backend/node_modules" ]; then
  du -sh backend/node_modules/*/ 2>/dev/null | sort -rh | head -15 >> "$REPORT"
else
  echo "(backend/node_modules 不存在，跳过)" >> "$REPORT"
fi

{
  echo ""
  echo "===== 4. 前端最大依赖 (>5MB) ====="
} >> "$REPORT"
if [ -d "frontend/node_modules" ]; then
  du -sh frontend/node_modules/*/ 2>/dev/null | sort -rh | head -15 >> "$REPORT"
else
  echo "(frontend/node_modules 不存在，跳过)" >> "$REPORT"
fi

# ── 3. depcheck（如果可用）───────────────────────────────────
log "[3/4] 运行 depcheck..."
for dir in "backend" "frontend" "desktop"; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "  $dir: node_modules 不存在，跳过 depcheck" >> "$REPORT"
    continue
  fi
  if command -v npx >/dev/null 2>&1; then
    {
      echo ""
      echo "===== 5. $dir depcheck 结果 ====="
    } >> "$REPORT"
    # depcheck 可能不存在，用 try-catch
    npx --yes depcheck "$ROOT/$dir" --json 2>/dev/null >> "$REPORT" || \
      echo "  depcheck 不可用或出错，请手动安装: npm install -g depcheck" >> "$REPORT"
  fi
done

# ── 4. npm audit 摘要 ────────────────────────────────────────
log "[4/4] 运行 npm audit..."
for dir in "backend" "frontend" "desktop"; do
  if [ ! -d "$dir/node_modules" ]; then
    continue
  fi
  {
    echo ""
    echo "===== 6. $dir npm audit ====="
    cd "$ROOT/$dir"
    npm audit --production --audit-level=high 2>&1 | tail -20
    cd "$ROOT"
  } >> "$REPORT"
done

log "报告已生成: $REPORT"
echo ""
echo "============================================"
echo " 依赖清理报告已生成"
echo " 路径: $REPORT"
echo "============================================"
echo ""
echo "审查后如需清理未使用的包，可以执行："
echo "  npm uninstall <pkg> --prefix backend"
echo "  npm uninstall <pkg> --prefix frontend"
echo "  npm uninstall <pkg> --prefix desktop"
echo ""
echo "如需修复 npm audit 漏洞："
echo "  npm audit fix --prefix backend"
echo "  npm audit fix --prefix frontend"
echo "  npm audit fix --prefix desktop"
