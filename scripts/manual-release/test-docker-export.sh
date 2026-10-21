#!/usr/bin/env bash
# GitHub CI ephemeral daemon only: synthetic FROM scratch, no pull/network or server.
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo 'CI-only Docker export fixture' >&2; exit 1; }
root="$(cd "$(dirname "$0")" && pwd)"
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]]
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
printf 'synthetic-no-production-data\n' > "$fixture/payload"
printf 'FROM scratch\nCOPY payload /payload\n' > "$fixture/Dockerfile"
for service in backend frontend; do
  docker build --network=none --label "org.opencontainers.image.revision=$sha" \
    --label io.flowcube.quantity-return-cash-contract=1 --label "io.flowcube.test-service=$service" \
    -t "flowcube-$service:$sha" "$fixture"
  docker image inspect -f '{{.Id}}' "flowcube-$service:$sha" > "$fixture/$service.id"
done
docker save "flowcube-backend:$sha" "flowcube-frontend:$sha" | gzip > "$fixture/images.tar.gz"
python3 -B - "$root" "$fixture" "$sha" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0,sys.argv[1])
from protocol import verify_docker_archive
root=Path(sys.argv[2])
verify_docker_archive(root/'images.tar.gz',sys.argv[3],{s:(root/(s+'.id')).read_text().strip() for s in ('backend','frontend')})
print('Real Docker export passes offline identity parser; synthetic CI data only')
PY
