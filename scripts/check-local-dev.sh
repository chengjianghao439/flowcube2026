#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "本地静态检查：$(node --version)"
npm --prefix backend run lint
npm --prefix frontend run lint
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit
npm --prefix frontend run test:unit
npm run test:permissions
echo '本地静态与前端检查通过；数据库业务回归和页面验收需另行执行。'
