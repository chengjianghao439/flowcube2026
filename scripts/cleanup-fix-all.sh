#!/usr/bin/env bash
# ============================================================
# FlowCube 一键安全修复执行脚本
# 按 P0 → P2 优先级顺序执行所有修复
#
# 运行前请确认：
#   1. 当前在 main 分支且工作区 clean
#   2. 已备份重要数据
#   3. 已阅读各步骤的说明
#
# 使用：
#   bash scripts/cleanup-fix-all.sh              # 预览模式（仅报告）
#   bash scripts/cleanup-fix-all.sh --apply       # 执行模式
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:---preview}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT="$ROOT/.fix-all-report-$TIMESTAMP.txt"
BACKUP_DIR="$ROOT/.backup-fix-$TIMESTAMP"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
step() { log ">>> [$1/$4] $2"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

# ── 前置检查 ──────────────────────────────────────────────────
if [ "$MODE" = "--apply" ]; then
  # 确保工作区 clean
  if [ -n "$(git status --porcelain)" ]; then
    warn "工作区有未提交变更，请先提交或 stash"
    git status --short
    exit 1
  fi
  # 确认备份
  mkdir -p "$BACKUP_DIR"
  log "备份目录: $BACKUP_DIR"
fi

{
  echo "============================================"
  echo " FlowCube 修复执行报告"
  echo " 模式: $MODE"
  echo " 时间: $(date)"
  echo "============================================"
  echo ""
} > "$REPORT"

# ═══════════════════════════════════════════════════════════════
# P0: 敏感信息清理
# ═══════════════════════════════════════════════════════════════
TOTAL_STEPS=7
step 1 "P0: 检查敏感文件" $TOTAL_STEPS | tee -a "$REPORT"

{
  echo "--- P0: 敏感文件 ---"
  echo "flowcube_backup.sql: $(git ls-files flowcube_backup.sql 2>/dev/null || echo '未跟踪 ✅')"
  echo "检查 .env 文件:"
  git ls-files | grep -i '\.env' || echo "  无 .env 文件被跟踪 ✅"
  echo "检查密钥文件:"
  git ls-files | grep -E '\.(pem|key)$|id_rsa|id_ed25519' || echo "  无密钥文件被跟踪 ✅"
  echo ""
} >> "$REPORT"

# ═══════════════════════════════════════════════════════════════
# P0: 依赖漏洞修复
# ═══════════════════════════════════════════════════════════════
step 2 "P0: 修复依赖漏洞" $TOTAL_STEPS | tee -a "$REPORT"

for dir in "backend" "frontend" "desktop"; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "  $dir: node_modules 不存在，npm ci" >> "$REPORT"
    if [ "$MODE" = "--apply" ]; then
      (cd "$ROOT/$dir" && npm ci --omit=dev) || warn "npm ci failed for $dir"
    fi
  fi

  if [ "$MODE" = "--apply" ]; then
    {
      echo "  --- $dir npm audit fix ---"
      cd "$ROOT/$dir"
      npm audit fix --production 2>&1 | tail -10
      cd "$ROOT"
    } >> "$REPORT"
  else
    {
      echo "  --- $dir npm audit (预览) ---"
      cd "$ROOT/$dir"
      npm audit --production --audit-level=high 2>&1 | tail -15
      cd "$ROOT"
    } >> "$REPORT"
  fi
done

# 手动修复：multer 需要大版本升级
if [ "$MODE" = "--apply" ]; then
  # 检查 multer 版本并强制升级到 2.x
  MULTER_VER=$(node -p "require('./backend/node_modules/multer/package.json').version" 2>/dev/null || echo "0")
  if [ "$(echo "$MULTER_VER" | cut -d. -f1)" -lt 2 ]; then
    log "升级 multer: 1.x -> 2.x（修复 high 漏洞）"
    (cd "$ROOT/backend" && npm install multer@^2.1.1) >> "$REPORT" 2>&1
  fi
  # 升级 axios 到 1.15.2+
  AXIOS_VER=$(node -p "require('./frontend/node_modules/axios/package.json').version" 2>/dev/null || echo "0")
  if [ "$(echo "$AXIOS_VER" | cut -d. -f2)" -lt 16 ] && [ "$(echo "$AXIOS_VER" | cut -d. -f1)" -eq 1 ] 2>/dev/null; then
    log "升级 axios: $AXIOS_VER -> latest（修复多个 high 漏洞）"
    (cd "$ROOT/frontend" && npm install axios@^1.15.2) >> "$REPORT" 2>&1
  fi
fi

# ═══════════════════════════════════════════════════════════════
# P1: Docker 安全加固
# ═══════════════════════════════════════════════════════════════
step 3 "P1: Docker 安全加固" $TOTAL_STEPS | tee -a "$REPORT"

{
  echo "--- Docker Compose MySQL 端口 ---"
  grep -n 'MYSQL_PORT' docker-compose.yml
  echo ""
  echo "建议：生产环境部署用 docker-compose.prod.yml 覆盖，"
  echo "      将 MySQL 端口绑定改为仅内部访问。"
  echo ""
} >> "$REPORT"

if [ "$MODE" = "--apply" ]; then
  # 修改 docker-compose.yml：MySQL 端口默认改为仅容器内部访问
  # 当前: ports: - "${MYSQL_PORT:-3306}:3306"
  # 改为: ports: - "127.0.0.1:${MYSQL_PORT:-3306}:3306"  （仅本机访问）
  # 生产环境使用 docker-compose.prod.yml 完全关闭
  log "加固 MySQL 端口绑定: 默认改为 127.0.0.1 绑定"
  cp docker-compose.yml "$BACKUP_DIR/docker-compose.yml.bak"
  sed -i 's/- "${MYSQL_PORT:-3306}:3306"/- "127.0.0.1:${MYSQL_PORT:-3306}:3306"/' docker-compose.yml

  # 加固后端端口：生产环境建议仅 127.0.0.1
  sed -i 's/- "3000:3000"/- "127.0.0.1:3000:3000"/' docker-compose.yml

  log "docker-compose.yml 已更新。备份在: $BACKUP_DIR/docker-compose.yml.bak"
fi

# ═══════════════════════════════════════════════════════════════
# P1: 调试代码删除
# ═══════════════════════════════════════════════════════════════
step 4 "P1: 清理调试代码" $TOTAL_STEPS | tee -a "$REPORT"

if [ "$MODE" = "--apply" ]; then
  bash "$ROOT/scripts/cleanup-debug-logs.sh" --apply >> "$REPORT" 2>&1 || warn "调试代码清理脚本执行异常"
else
  bash "$ROOT/scripts/cleanup-debug-logs.sh" >> "$REPORT" 2>&1 || true
fi

# ═══════════════════════════════════════════════════════════════
# P1: 无用依赖分析（只读）
# ═══════════════════════════════════════════════════════════════
step 5 "P1: 无用依赖分析" $TOTAL_STEPS | tee -a "$REPORT"

bash "$ROOT/scripts/cleanup-dep-report.sh" >> "$REPORT" 2>&1 || warn "依赖分析脚本执行异常"

# ═══════════════════════════════════════════════════════════════
# P2: 死代码检测
# ═══════════════════════════════════════════════════════════════
step 6 "P2: 死代码检测" $TOTAL_STEPS | tee -a "$REPORT"

{
  echo "--- 后端未引用 controller ---"
  for f in $(find "$ROOT/backend/src/modules" -name '*.controller.js' 2>/dev/null); do
    name=$(basename "$f" .js)
    count=$(grep -r "$name" "$ROOT/backend/src/modules" --include='*.routes.js' -l 2>/dev/null | wc -l)
    if [ "$count" -eq 0 ]; then
      echo "  ⚠️  $f"
    fi
  done
  echo ""
  echo "--- 前端未注册路由页面 ---"
  for dir in "$ROOT/frontend/src/pages/"*/; do
    name=$(basename "$dir")
    count=$(grep -r "$name" "$ROOT/frontend/src/router" --include='*.tsx' -l 2>/dev/null | wc -l)
    if [ "$count" -eq 0 ]; then
      echo "  ⚠️  $name"
    fi
  done
  echo ""
} >> "$REPORT"

# ═══════════════════════════════════════════════════════════════
# 提交变更
# ═══════════════════════════════════════════════════════════════
step 7 "汇总变更" $TOTAL_STEPS | tee -a "$REPORT"

if [ "$MODE" = "--apply" ]; then
  log "变更文件:"
  git diff --stat >> "$REPORT"
  log ""
  log "⚠️  请审查变更后再提交: git diff"
  log "   确认无误后: git add . && git commit -m 'chore: security cleanup and hardening'"
  log "   备份在: $BACKUP_DIR/"
else
  log "预览模式完成。未做任何修改。"
  log "审查报告: $REPORT"
  log "确认后运行: bash $0 --apply"
fi

echo ""
echo "============================================"
echo " 修复扫描完成"
echo " 报告: $REPORT"
echo "============================================"
