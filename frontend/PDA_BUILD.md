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
| JDK | 21，与[正式构建](../.github/workflows/build-pda-apk.yml)和 [Gradle](android/app/capacitor.build.gradle) 一致 | https://adoptium.net |
| Android Studio | 支持项目 [Gradle Wrapper](android/gradle/wrapper/gradle-wrapper.properties) | https://developer.android.com/studio |
| Android SDK | 根据 [SDK 配置](android/variables.gradle)安装 compile SDK。当前为 35，设备最低为 API 23 | 使用 SDK Manager |
| Node.js | 22.13 及以上的 22.x，见[版本声明](../package.json) | https://nodejs.org |

安装完成后确保以下环境变量已设置：
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk        # macOS
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
```

## 本地调试 APK

静态资源内嵌在 APK 中，无需网络连接即可运行界面，API 请求仍需连接后端服务器。

打包前必须提供内置后端地址，二选一：

```bash
export VITE_ERP_PRODUCTION_ORIGIN=https://jixuflow.com
```

或在仓库根目录创建 `deploy/production.local.json`，填写 `erpOrigin`。

```bash
cd frontend
./build-pda-apk.sh
```

APK 输出路径：
```
android/app/build/outputs/apk/debug/app-debug.apk
```

## 手动打包步骤

以下命令从仓库根目录执行：

```bash
# 1. 构建前端（注入 PDA 默认服务器地址）
VITE_ERP_PRODUCTION_ORIGIN=https://jixuflow.com node scripts/build-frontend-bundle.js pda

# 2. 同步到 Android 项目
cd frontend
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
A. 先核对新旧包的应用 ID 与签名。生产设备使用签名一致的正式 APK 升级。调试包在专用测试设备安装。卸载会删除应用本地数据，先核对本地会话和未决操作恢复记录，避免为调试覆盖现场。

**Q. 如何生成正式 APK**

A. 走[正式发布流程](../docs/RELEASE.md#正式发布流程唯一入口)，由 [Build PDA APK](../.github/workflows/build-pda-apk.yml)对同一提交执行原生扫码测试、构建、签名及发布校验。
