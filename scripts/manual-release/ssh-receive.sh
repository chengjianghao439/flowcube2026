#!/bin/sh
# Install root-owned; authorized_keys forces this wrapper. No user-selected argv.
set -eu
[ "$#" -eq 0 ] && [ "${SSH_ORIGINAL_COMMAND:-}" = 'receive-v1' ] || { echo 'Command outside release allowlist' >&2; exit 1; }
exec /usr/bin/sudo -n -- /usr/local/lib/flowcube-release/scripts/manual-release/receive.py
