#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# FlowCube database backup script
#
# Supported modes (auto-detected):
#   Docker mode  -- calls mysqldump inside the MySQL container
#   Local mode   -- calls mysqldump on the host (Homebrew / macOS package / PATH)
#
# Usage:
#   Manual         ./scripts/backup.sh
#   Cron (host)    0 2 * * * /path/to/flowcube/scripts/backup.sh
#   Force mode     USE_DOCKER=true  ./scripts/backup.sh
#                  USE_DOCKER=false ./scripts/backup.sh
#
# Environment variables (all have defaults; can be overridden in backend/.env):
#   DB_HOST            MySQL host          (default: 127.0.0.1)
#   DB_PORT            MySQL port          (default: 3306)
#   DB_USER            MySQL user          (default: flowcube)
#   DB_PASSWORD        MySQL password      (default: empty)
#   DB_NAME            database name       (default: flowcube)
#   DOCKER_CONTAINER   container name      (default: flowcube-mysql)
#   BACKUP_DIR         output directory    (default: <project-root>/backups/daily)
#   KEEP_DAYS          retention days      (default: 7)
#   USE_DOCKER         auto|true|false     (default: auto)
#   MYSQL_BIN          directory that contains mysqldump (optional override)
#   MIN_BYTES          minimum valid file size in bytes (default: 1024)
# -----------------------------------------------------------------------------

set -euo pipefail

# --- paths and config --------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../backend/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-flowcube}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-flowcube}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-flowcube-mysql}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups/daily}"
KEEP_DAYS="${KEEP_DAYS:-7}"
USE_DOCKER="${USE_DOCKER:-auto}"
MIN_BYTES="${MIN_BYTES:-1024}"

# --- logging -----------------------------------------------------------------

_ts()       { date '+%Y-%m-%d %H:%M:%S'; }
log_info()  { echo "[$(_ts)] [INFO]  $*"; }
log_warn()  { echo "[$(_ts)] [WARN]  $*" >&2; }
log_error() { echo "[$(_ts)] [ERROR] $*" >&2; }

# --- Docker mode detection ---------------------------------------------------

use_docker() {
  case "$USE_DOCKER" in
    true)  return 0 ;;
    false) return 1 ;;
    *)
      # auto: check whether the target container is running
      docker ps --format '{{.Names}}' 2>/dev/null \
        | grep -qx "$DOCKER_CONTAINER"
      ;;
  esac
}

# --- mysqldump path resolution (local mode only) -----------------------------

find_mysqldump() {
  # 1. explicit override via MYSQL_BIN environment variable
  if [ -n "${MYSQL_BIN:-}" ]; then
    local candidate="$MYSQL_BIN/mysqldump"
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
    log_warn "MYSQL_BIN is set to '$MYSQL_BIN' but mysqldump is not executable there; falling through."
  fi

  # 2. PATH lookup
  local found
  found="$(command -v mysqldump 2>/dev/null || true)"
  if [ -n "$found" ] && [ -x "$found" ]; then
    echo "$found"
    return 0
  fi

  # 3. fixed well-known paths (Homebrew Intel / Apple Silicon, system)
  local fixed_paths=(
    /opt/homebrew/bin/mysqldump
    /opt/homebrew/opt/mysql-client/bin/mysqldump
    /opt/homebrew/opt/mysql/bin/mysqldump
    /usr/local/bin/mysqldump
    /usr/local/mysql/bin/mysqldump
    /usr/bin/mysqldump
  )
  local p
  for p in "${fixed_paths[@]}"; do
    if [ -x "$p" ]; then
      echo "$p"
      return 0
    fi
  done

  # 4. versioned macOS MySQL package: /usr/local/mysql-<version>-*/bin/mysqldump
  for p in /usr/local/mysql-*/bin/mysqldump; do
    if [ -x "$p" ]; then
      echo "$p"
      return 0
    fi
  done

  return 1
}

# --- main backup logic -------------------------------------------------------

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
FILENAME="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

log_info "Starting backup: $DB_NAME -> $(basename "$FILENAME")"

if use_docker; then
  log_info "Mode: Docker (container $DOCKER_CONTAINER)"
  docker exec "$DOCKER_CONTAINER" \
    mysqldump \
      -u "$DB_USER" \
      -p"$DB_PASSWORD" \
      --single-transaction \
      --routines \
      --triggers \
      --add-drop-table \
      "$DB_NAME" 2>/dev/null \
    | gzip > "$FILENAME"
else
  DUMP_CMD="$(find_mysqldump || true)"

  if [ -z "$DUMP_CMD" ]; then
    log_error "mysqldump not found. Install MySQL client, set MYSQL_BIN, or use USE_DOCKER=true."
    exit 1
  fi

  log_info "Mode: local ($DUMP_CMD)"
  "$DUMP_CMD" \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    -p"$DB_PASSWORD" \
    --single-transaction \
    --routines \
    --triggers \
    --add-drop-table \
    "$DB_NAME" 2>/dev/null \
    | gzip > "$FILENAME"
fi

# --- validate backup file is not empty ---------------------------------------

ACTUAL_BYTES="$(wc -c < "$FILENAME" | tr -d ' ')"
if [ "$ACTUAL_BYTES" -lt "$MIN_BYTES" ]; then
  log_error "Backup file looks corrupt (${ACTUAL_BYTES} bytes < threshold ${MIN_BYTES}): $FILENAME"
  rm -f "$FILENAME"
  exit 1
fi

SIZE="$(du -sh "$FILENAME" | cut -f1)"
log_info "Backup complete: $(basename "$FILENAME") ($SIZE)"

# --- purge old backups -------------------------------------------------------

log_info "Purging backups older than $KEEP_DAYS days..."

find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true

REMAINING="$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" | wc -l | tr -d ' ')"
log_info "Backup files retained: $REMAINING (policy: $KEEP_DAYS days)"
log_info "Done."
