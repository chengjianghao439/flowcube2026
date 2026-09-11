# v0.9.14 发布范围与验收

## 发布内容

三端版本 0.9.14；PDA versionCode 122。标签中文与预览一致性实现见 `docs/label-raster-2026-09-11.md`，用户更新说明见 `docs/release-notes/0.9.14.md`。不包含已取消的 Windows 付费签名方案；本版不改变安装包签名状态。

发布准备同时更新 multer 2.2.0 → 2.3.0、前端工具链 js-yaml 4.3.1 → 4.3.2，修复完整依赖审计发现的高危项。导入和 Logo 上传的现有消费者只提交一个文件、没有 multipart 文本业务字段；接口限制单文件并拒绝额外文本字段，避免无业务用途的嵌套/数组字段消耗解析资源。`test:upload` 使用真实 multipart HTTP 请求覆盖六个上传入口的正常文件接收及额外字段/第二个文件拒绝，使用真实全局错误处理验证 HTTP 400，不连接数据库；已接入 Tests CI。

上游依据：[multer 公告](https://github.com/advisories/GHSA-535w-7cp7-47q4)、[js-yaml 公告](https://github.com/advisories/GHSA-2883-xcg3-v3hh)。不执行 audit force 或无关的测试框架大版本迁移；完整审计继续由现有 high/critical 门禁阻断。

## 发布核验规则

本文件随发布候选提交，不能单凭版本文件认定部署成功。正式结果核对同一提交 SHA 的 Tests、Security Scan、Deploy Browser App、Windows tag 发布及 PDA 发布工作流；另检查健康/就绪、桌面和 PDA 线上清单、下载文件 SHA-256。实际运行结果与日志保存于发布工作树 `output/release-v0.9.14/`，完成说明报告真实状态。

本地发布前复测通过：上传 6 项、标签 88 项、打印 33 项、前端 55 个文件共 284 项；前后端 lint（前端 5 条既有警告、0 错误）、应用类型检查、ERP/PDA Web 构建通过。完整依赖审计后端/桌面为零，前端保留 vitest 与 @vitest/mocker 两项 moderate 开发工具告警，三端 high/critical 均为零。独立测试库的标签入队/预览验证、本地开发页效果已在标签实现文档记录；Linux 原生绘图库及字体由后端镜像构建中的 `check-label-renderer.cjs` 强制验证。

首次 CI 库存回归检出旧测试要求 ZPL 包含条码明文，与点阵契约不符；改为直接解码实际队列的 `^GFA` 图像并比对容器条码，保留原事务、幂等和数量断言。新测试不通过重新渲染期望值自证。

## 验收边界

本次不新增数据库迁移，不重绘历史已排队/补打快照。真实标签机走纸、浓度、扫码以及 Windows 安装/PDA 安装操作仍需设备验收；自动化像素比较和独立条码解码不能替代真机证明。DPI 必须与设备一致，新版效果使用新建打印任务验证。
