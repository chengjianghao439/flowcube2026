#!/usr/bin/env bash
# 旧版平铺上传脚本已停用。桌面安装包发布必须走 scripts/release-desktop.js，
# 在服务器本地写入 /var/www/flowcube-downloads/versions/vX.Y.Z。
set -euo pipefail

echo "此脚本已停用：禁止把 latest.json 和 exe 平铺上传到旧 downloads 目录。"
echo "请在服务器上执行："
echo "  node scripts/release-desktop.js <version> --artifact=/path/to/installer.exe"
echo
echo "示例："
echo "  node scripts/release-desktop.js 1.0.4 --dry-run"
echo "  node scripts/release-desktop.js 1.0.4 --artifact=/tmp/FlowCube-Setup-1.0.4.exe"
exit 1
