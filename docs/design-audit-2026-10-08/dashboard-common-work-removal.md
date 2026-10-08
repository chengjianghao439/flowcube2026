# 后续：移除仪表盘常用工作

2026-10-08，用户截图明确要求删除仪表盘整块“常用工作”。在原重构工作树实施，采用impeccable distill的去除冗余入口方法；现行用户要求覆盖B6旧“首页与待办共用”约定。

`frontend/src/pages/dashboard/index.tsx`删除DailyWork导入和渲染，标题后直接显示原个人卡片。待办中心原组件、权限、路径、工作区导航仍沿原合同；没有删除业务路由或更改保存布局。DailyWork的用途注释及frontend-pda-conventions同步。

已有DailyWork集成用例调整为真实组件/待办入口验证，仪表盘用例明确断言区块不存在、卡片顺序/隐藏偏好/保存载荷保持；KeepAlive选择已打开列表继续保留query、草稿和其他单据。更新期望后自然1失败/11通过，移除产品渲染后2文件12例通过。类型检查及三个文件scoped lint exit0；相关约定/文档守卫另存日志。全量、构建待后续批次/发版前统一验证，本次没有把旧1877通过冒充新执行。

浏览器实际加载原DashboardPage组件，QueryClient只注入合成布局、库存空数组及销售指标3；所有API adapter禁止网络，请求记录before/after/cancel均为空。不是完整登录、真实API或真实账户验收。临时HTML源保存于`scripts/design-audit/dashboard-removal-preview.html`；原始/修改后1440×900浅色和修改后1024×900深色均已逐张看。

- [修改前](screens/before/dashboard-common-work-removal-1440.png)出现截图的整块常用工作。
- [修改后](screens/after/dashboard-common-work-removal-1440.png)区块不存在，同一指标卡片上移、数据3保持，无页面横溢出。
- [编辑/取消后的深色](screens/after/dashboard-common-work-removal-dark-1024.png)仍无此区块，原卡片保持；没有点击保存或触发业务写入。

DOM记录见[dashboard-removal-observations.json](dashboard-removal-observations.json)，回归日志见[verification/dashboard-removal](verification/dashboard-removal/)。首次预览工作目录、夹具import扩展名和非布尔wait探针的设置错误已纠正；对应失败不计产品视觉结论，原始照片只保留成功挂载后的真实状态。

独立稳定浏览器`flowcube-dashboard-remove`已close/list确认退出；本任务Vite精确进程已停止，5188无监听；frontend临时HTML已核对自建源后删除。没有起API/数据库，不触及共享3307或生产。覆盖清单已按当前源码重生并通过两个check：145路由、1149候选用点、5516组件调用；本组件夹具不会新增全部业务页面通过数。未提交、推送或发布。
