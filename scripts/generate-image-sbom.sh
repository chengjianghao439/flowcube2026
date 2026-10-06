#!/usr/bin/env bash
# Scan exported image bytes with a reviewed scanner; never expose Docker socket or credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
archive="${1:?image archive is required}"
reports="${FLOWCUBE_IMAGE_REPORT_DIR:?FLOWCUBE_IMAGE_REPORT_DIR is required}"
sha="${GITHUB_SHA:?GITHUB_SHA is required}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] && [ "$(git rev-parse HEAD)" = "$sha" ]
[ "${GITHUB_ACTIONS:-}" = true ]
test -s "$archive"
mkdir -p "$reports"
scan_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/flowcube-sbom.XXXXXX")"
trap 'rm -rf "$scan_dir"' EXIT
scanner='anchore/syft:v1.54.0@sha256:0356562f495d432056237fbea5cbc2d4839c9c75cd500784a66de2e7cc95ca7c'
docker pull "$scanner"
for service in backend frontend; do
  docker save "flowcube-$service:$sha" > "$scan_dir/$service.tar"
  # Syft retains every uncompressed layer: the backend lower bound is already
  # 294607349 bytes. Keep its 1 GiB cache inside a finite 2 GiB memory budget.
  docker run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges \
    --read-only --memory=2g --memory-swap=2g --cpus=2 \
    --tmpfs /tmp:rw,noexec,nosuid,size=1g \
    -e HOME=/tmp -v "$scan_dir:/scan:ro" -v "$reports:/out" \
    "$scanner" scan "docker-archive:/scan/$service.tar" \
    -o "cyclonedx-json=/out/$service.sbom.json"
  docker image inspect --format '{{.Id}}' "flowcube-$service:$sha" > "$reports/$service.image-id"
  rm -f "$scan_dir/$service.tar"
done
node scripts/write-image-provenance.cjs "$archive" "$reports"
