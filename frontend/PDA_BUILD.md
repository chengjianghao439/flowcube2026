# FlowCube PDA — Android APK 打包说明

## 项目结构

```
frontend/
├── android/                  # Capacitor 生成的 Android 原生项目
├── capacitor.config.ts       # Capacitor 配置
├── build-pda-apk.sh          # 一键打包脚本
└── src/main.tsx              # App 启动时自动跳转 /pda
```

## 环境要求

| 工具 | 版本要求 | 安装地址 |
|------|---------|----------|
| JDK  | 17+     | https://adoptium.net |
| Android Studio | 最新版 | https://developer.android.com/studio |
| Android SDK | API 23+ | 通过 Android Studio 安装 |
| Node.js | 18+ | https://nodejs.org |

安装完成后确保以下环境变量已设置：
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk        # macOS
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
```

## 打包方式一：本地离线包（推荐）

静态资源内嵌在 APK 中，无需网络连接即可运行界面，API 请求仍需连接后端服务器。

```bash
cd frontend
./build-pda-apk.sh
```

APK 输出路径：
```
android/app/build/outputs/apk/debug/app-debug.apk
```

## 手动打包步骤

```bash
# 1. 构建前端（跳过 PWA）
cd frontend
BUILD_TARGET=pda npm run build

# 2. 同步到 Android 项目
npx cap copy android
npx cap sync android

# 3. 用 Android Studio 打开项目
npx cap open android

# 4. 在 Android Studio 中：
#    Build → Build Bundle(s) / APK(s) → Build APK(s)
```

## 安装到 PDA 设备

**方式一：ADB 安装**
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

**方式二：直接传输**
将 APK 文件通过 USB 或文件传输到设备，在设备上点击安装（需开启「允许未知来源」）。

## App 行为说明

| 功能 | 说明 |
|------|------|
| 启动路由 | 自动跳转 `/pda/login`（未登录）或 `/pda`（已登录） |
| 全屏模式 | 隐藏状态栏和导航栏，沉浸式体验 |
| 屏幕常亮 | 防止扫码过程中设备自动锁屏 |
| 返回键 | 在 WebView 内返回历史页面，不退出 App |
| 屏幕方向 | 强制竖屏 |
| 网络访问 | 使用安装包内置服务器地址访问后端 |

## 常见问题

**Q: 构建报错 `SDK location not found`**  
A: 在 `android/local.properties` 中设置：
```
sdk.dir=/Users/你的用户名/Library/Android/sdk
```

**Q: 安装报错 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`**  
A: 先卸载旧版本再安装：`adb uninstall com.flowcube.pda`

**Q: 如何生成 Release APK 用于生产**  
A: 需要签名密钥，在 Android Studio 中：  
`Build → Generate Signed Bundle / APK → APK → 填写密钥信息`
