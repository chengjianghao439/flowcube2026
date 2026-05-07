#!/usr/bin/env bash
# ============================================================
# FlowCube 调试代码清理 — 预览+执行 双模式
#
# 用途：扫描并移除 JS/TS 源文件中遗留的调试语句
# - console.log() 无业务注释的行
# - debugger 语句
# - 被注释掉的调试代码块
#
# 使用：
#   bash scripts/cleanup-debug-logs.sh          # 预览模式（只报告，不改文件）
#   bash scripts/cleanup-debug-logs.sh --apply  # 执行模式（修改文件）
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:---preview}"
BACKUP_DIR="$ROOT/.backup-debug-cleanup-$(date +%Y%m%d-%H%M%S)"
SUMMARY_FILE="$ROOT/.debug-cleanup-summary-$(date +%Y%m%d).txt"
EXCLUDE_DIRS="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=release --exclude-dir=android --exclude-dir=.gradle --exclude-dir=.playwright-cli"
INCLUDE_FILES="--include=*.js --include=*.ts --include=*.tsx"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

# ── 阶段 1: 预览扫描 ────────────────────────────────────────
log "===== 阶段 1: 扫描遗留调试语句 ====="
{
  echo "=== FlowCube 调试代码清理报告 ==="
  echo "生成时间: $(date)"
  echo "模式: $MODE"
  echo ""
} > "$SUMMARY_FILE"

# 1-a: 扫描 debugger
echo "" >> "$SUMMARY_FILE"
echo "--- 1-a: debugger 语句 ---" >> "$SUMMARY_FILE"
DEBUGGER_FILES=$(grep -rln 'debugger' $EXCLUDE_DIRS $INCLUDE_FILES . 2>/dev/null || true)
if [ -n "$DEBUGGER_FILES" ]; then
  echo "$DEBUGGER_FILES" >> "$SUMMARY_FILE"
  DEBUGGER_COUNT=$(echo "$DEBUGGER_FILES" | wc -l)
else
  echo "(无)" >> "$SUMMARY_FILE"
  DEBUGGER_COUNT=0
fi

# 1-b: 扫描 console.log （排除合法日志）
echo "" >> "$SUMMARY_FILE"
echo "--- 1-b: console.log (不含源码中带业务注释的合法日志) ---" >> "$SUMMARY_FILE"
# 排除模式：排除包含 debug/info/warn/error 等日志工具调用的行
CONSOLE_LOG_LINES=$(grep -rn 'console\.log' $EXCLUDE_DIRS $INCLUDE_FILES . 2>/dev/null \
  | grep -v 'node_modules' \
  | grep -v '//.*console.*log\|//.*debug' \
  | grep -v 'logger\..*(.*console' \
  || true)
if [ -n "$CONSOLE_LOG_LINES" ]; then
  echo "$CONSOLE_LOG_LINES" >> "$SUMMARY_FILE"
  CONSOLE_LINE_COUNT=$(echo "$CONSOLE_LOG_LINES" | wc -l)
else
  echo "(无)" >> "$SUMMARY_FILE"
  CONSOLE_LINE_COUNT=0
fi

# 1-c: 扫描被大段注释的代码块（/**/中含 function/const/let 的）
echo "" >> "$SUMMARY_FILE"
echo "--- 1-c: 注释掉的代码块 (注释内的 function/const/let) ---" >> "$SUMMARY_FILE"
# 仅扫描 .js .ts 文件中的多行注释
BLOCK_COMMENTS=$(grep -rn '\/\*' $EXCLUDE_DIRS $INCLUDE_FILES . 2>/dev/null \
  | grep -v 'node_modules' \
  | grep -v 'LICENSE\|Copyright\|@license\|@ts-' \
  | head -30 || true)
if [ -n "$BLOCK_COMMENTS" ]; then
  echo "$BLOCK_COMMENTS" >> "$SUMMARY_FILE"
fi

echo "" >> "$SUMMARY_FILE"
echo "--- 统计 ---" >> "$SUMMARY_FILE"
echo "debugger 文件数: $DEBUGGER_COUNT" >> "$SUMMARY_FILE"
echo "console.log 行数: $CONSOLE_LINE_COUNT" >> "$SUMMARY_FILE"

log "debugger 文件数: $DEBUGGER_COUNT"
log "console.log 行数: $CONSOLE_LINE_COUNT"
log "报告已保存: $SUMMARY_FILE"

# ── 阶段 2: 如果是预览模式，退出 ────────────────────────────
if [ "$MODE" != "--apply" ]; then
  log ""
  log "⚠️  预览模式，未做任何修改。"
  log "   请先审查: $SUMMARY_FILE"
  log "   确认无误后运行: bash $0 --apply"
  exit 0
fi

# ── 阶段 3: 执行模式（备份 + 清理）──────────────────────────
log ""
log "===== 阶段 2: 执行清理 ====="
if [ "$DEBUGGER_COUNT" -eq 0 ] && [ "$CONSOLE_LINE_COUNT" -eq 0 ]; then
  log "无需要清理的内容。"
  exit 0
fi

# 创建备份
mkdir -p "$BACKUP_DIR"
log "备份目录: $BACKUP_DIR"

# 3-a: 删除 debugger 语句（保留行结构）
DEBUGGER_FILES=$(grep -rln 'debugger' $EXCLUDE_DIRS $INCLUDE_FILES . 2>/dev/null || true)
if [ -n "$DEBUGGER_FILES" ]; then
  for f in $DEBUGGER_FILES; do
    cp "$f" "$BACKUP_DIR/$(echo "$f" | tr '/' '_')" 2>/dev/null || true
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' '/^[[:space:]]*debugger;*/d' "$f"
    else
      sed -i '/^[[:space:]]*debugger;*/d' "$f"
    fi
    log "  清理 debugger: $f"
  done
fi

# 3-b: 删除孤立的 console.log 行
# 保守策略：只删除单独成行的 console.log('xxx') 无其他逻辑的语句
CONSOLE_FILES=$(grep -rln 'console\.log' $EXCLUDE_DIRS $INCLUDE_FILES . 2>/dev/null \
  | grep -v 'node_modules' \
  | grep -v '\.test\.' \
  || true)
if [ -n "$CONSOLE_FILES" ]; then
  for f in $CONSOLE_FILES; do
    cp "$f" "$BACKUP_DIR/$(echo "$f" | tr '/' '_')" 2>/dev/null || true
    bak="$f.bak"
    cp "$f" "$bak"
    # 仅删除单独成行的 console.log(...) 调用（不删除含有 return/赋值等复合语句的行）
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' '/^[[:space:]]*console\.log(/d' "$f"
    else
      sed -i '/^[[:space:]]*console\.log(/d' "$f"
    fi
    # 检查是否有变更
    if diff -q "$bak" "$f" >/dev/null 2>&1; then
      mv "$bak" "$f"  # 恢复（无变更）
    else
      log "  清理 console.log: $f"
      rm -f "$bak"
    fi
  done
fi

log ""
log "===== 清理完成 ====="
log "备份在: $BACKUP_DIR"
log "恢复: cp $BACKUP_DIR/* <原路径>"
log ""
log "⚠️  请审查变更后再提交: git diff"
