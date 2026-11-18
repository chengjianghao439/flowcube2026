#!/bin/sh
# Optional, explicitly configured immutable copy. This never deletes remote history.
set -u
backup_dir="${OFFSITE_BACKUP_DIR:-/backups}"
status_dir="${OFFSITE_STATUS_DIR:-/status}"
interval="${OFFSITE_INTERVAL_SECONDS:-21600}"
max_age="${OFFSITE_MAX_AGE_SECONDS:-46800}"
max_pair_age="${OFFSITE_MAX_PAIR_AGE_SECONDS:-129600}"
case "$interval:$max_age:$max_pair_age" in
  *[!0-9:]*|::*|*::*|:*|*:) echo 'Invalid offsite backup schedule' >&2; exit 1;;
esac
[ "$interval" -gt 0 ] && [ "$max_age" -gt "$interval" ] && [ "$max_pair_age" -gt 0 ] || exit 1

if [ "${1:-once}" = health ]; then
  [ -r "$status_dir/state" ] && read -r state time pair_time < "$status_dir/state" || exit 1
  case "$time:$pair_time" in *[!0-9:]*|:*|*:) exit 1;; esac
  now=$(date +%s)
  [ "$state" = passed ] && [ "$now" -ge "$time" ] && [ "$((now-time))" -le "$max_age" ] &&
    [ "$now" -ge "$pair_time" ] && [ "$((now-pair_time))" -le "$max_pair_age" ]
  exit $?
fi

remote="${RCLONE_REMOTE:?Set the authorised offsite remote}"
mkdir -p "$status_dir" || exit 1
umask 077
copy_backups() {
  # Freeze the receipt list before data transfer. A backup completed while
  # copying is eligible for the next cycle, never for premature receipt copy.
  latest=''
  for file in "$backup_dir"/paired/flowcube_*.json; do
    if [ -f "$file" ]; then
      printf 'paired/%s\n' "${file##*/}" >> "$receipt_list" || return 1
      latest="$file"
    fi
  done
  rclone copy "$backup_dir" "$remote" --checksum --immutable --contimeout 30s --timeout 2m --max-duration 45m \
    --include '/flowcube_*.sql.gz' --include '/assistant/flowcube_*.json.gz' || return 1
  [ -n "$latest" ] || { echo 'No paired backup receipt is available' >&2; return 1; }
  pair_time=$(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest") || return 1
  case "$pair_time" in *[!0-9]*|'') return 1;; esac
  rclone copy "$backup_dir" "$remote" --checksum --immutable --contimeout 30s --timeout 2m --max-duration 15m \
    --files-from-raw "$receipt_list"
}

run_once() {
  result=passed
  pair_time=0
  receipt_list=$(mktemp "$status_dir/.copy-list-XXXXXX") || return 1
  trap 'rm -f "$receipt_list"' EXIT
  if ! copy_backups; then result=failed; fi
  rm -f "$receipt_list"
  trap - EXIT
  pending=$(mktemp "$status_dir/.state-XXXXXX") || return 1
  if ! printf '%s %s %s\n' "$result" "$(date +%s)" "$pair_time" > "$pending" || ! mv "$pending" "$status_dir/state"; then
    rm -f "$pending"
    return 1
  fi
  echo "Offsite backup: $result"
  [ "$result" = passed ]
}

case "${1:-once}" in
  once) run_once;;
  loop)
    while :; do
      run_once || echo 'Offsite backup failed; check the local status and retry' >&2
      sleep "$interval" || exit 1
    done
    ;;
  *) exit 2;;
esac
