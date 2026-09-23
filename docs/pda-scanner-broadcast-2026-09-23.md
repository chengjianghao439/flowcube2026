# i6310pro 原生扫码广播接入

## 现场证据与范围

- 设备：i6310pro，Android 12。设备自带扫码程序能识别条码；有焦点的记事本和极序 Flow 库存查询输入框能收到字符，库存查询无焦点直接扫码没有反应。设备扫码输出的具体设置页未找到。
- 既有 `usePdaScanner` 只监听 WebView `document.keydown`；作业页按用户要求不自动聚焦输入框。以上观察支持“键盘模拟输出依赖输入焦点”这一接收链路问题，不代表库存接口故障。
- 商家提供的 `Scanner-SDK-20241121.zip` 内有中英文开发文档、示例 APK/工程和两份不同版本的 JAR。示例工程依赖 `DeviceManagerNew_v231010.jar`，代码在 `onCreate` 调用 `ScanManager.switchOutputMode(0)`，在 `onResume` 读取当前广播 Action/字段并注册接收器。本项目复制的是示例工程实际依赖的 JAR；SHA256 为 `af1ec1ed88a965f88f0a2ca1598d2c9961e25e7cb460114e0fc96a52084a439c`。
- 厂商文档默认广播 Action 为 `android.intent.ACTION_DECODE_DATA`、字符串字段为 `barcode_string`；`getParameterString` 可读取设备上已改过的值。输出模式 0 为广播、1 为键盘。文档另提供 Android 11+ 设置广播，但本实现使用示例工程对应的 SDK 读取原模式与参数。

## 实现约定

- Android Capacitor `PdaScanBridge` 默认关闭；测试人员在「库存查询」主动点「开启无焦点扫码测试」后，才以 `RECEIVER_NOT_EXPORTED` 注册厂商广播接收器并尝试切换输出模式。这样可避免其他普通应用伪造条码进入收货/上架等写操作。开关仅在本次应用进程内有效；关闭或退后台时恢复原键盘模式，下次启动默认关闭。切换前同步记录待恢复状态，进程异常退出后，下次启动立即尝试恢复。
- 仅转发 Action 匹配且含非空条码字符串的广播。前端 `usePdaScanner` 把原生完整条码与既有键盘聚合结果送入同一回调和 1 秒防重复窗口；同一次扫描若由广播和键盘重复上报，静默丢弃跨来源副本。非厂商设备或 SDK 不可用时保留键盘路径。
- 不给作业页增加隐藏输入框或自动焦点；`PdaScanner` 手输框已打开时，硬件广播扫码仍可完成当前操作。调拨出入、上架等原本 `allowManualEntry={false}` 的页面继续强制扫码。

## 验证边界

- 前端原生事件、键盘/广播去重及手输框状态有组件测试；Android 模式恢复和广播内容校验有 JVM 测试。Debug APK 本地编译验证只证明可构建。
- 尚未在 i6310pro 真机安装、确认 SDK 能切换该固件的输出模式，或验证 `RECEIVER_NOT_EXPORTED` 能收到该固件的扫码广播。[Android 官方说明](https://developer.android.com/develop/background-work/background-tasks/broadcasts#context-registered-receivers)：该模式只接受本应用及部分系统广播；若厂商服务以其他 UID 发送，扫描会被安全地拒收。此时测试人员应关闭开关恢复原模式，不能改成无保护的 `RECEIVER_EXPORTED` 来绕过。需要让厂商提供受权限保护的广播或可信 SDK 回调后再接入。
- 远程真机验收先更新到测试版，在「库存查询」打开无焦点扫码测试并扫一枚已有库存条码；若无响应，立即在同页关闭开关，再点输入框确认原键盘扫码已恢复。有响应后，再到上架页只扫测试单据，不提交真实库存；离开极序 Flow 后确认记事本仍可扫码输入。跨应用伪造广播拒收还需具备外部测试应用时验证；未经过这些验收，不将此实现宣称为正式修复。
- Debug APK 与已发布包签名不同，不直接覆盖现场正式包。安装方案须先保证可回退和保留设备登录/绑定状态；本任务未推送、发版或改变生产设备。
