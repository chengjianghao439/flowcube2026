#!/usr/bin/env bash
# build-pda-apk.sh
# FlowCube PDA Android APK 打包脚本
# 使用方式：
#   ./build-pda-apk.sh                        # 本地离线包（内嵌静态资源）
#   PDA_SERVER_URL=http://192.168.8.109:5173 ./build-pda-apk.sh  # 连接服务器 Live 模式

set -e
cd "$(dirname "$0")"

echo "[1/4] 构建前端静态资源（跳过 PWA）..."
BUILD_TARGET=pda npm run build

echo "[2/4] 同步到 Android 项目..."
npx cap copy android
npx cap sync android

echo "[3/4] 编译 Android APK（需要 JDK 17+ 和 Android SDK）..."
cd android
./gradlew assembleDebug

echo "[4/4] APK 位置："
find . -name "*.apk" -type f
echo ""
echo "✅ 打包完成！将 APK 文件传输到 PDA 设备安装即可。"
