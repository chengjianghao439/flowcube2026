# ERP 前端统一样式 Implementation Plan

> 使用当前任务逐项执行；保留既有工作区变更，用户未要求提交或发布。

**Goal:** 将已确认的紧凑业务界面设计扩展至全部 ERP 路由及其共用表单、查询与列表。

**Architecture:** 先修整现有共享组件的视觉和可访问性，再把重复的查询布局收口为 QueryFormLayout；独立表单和列表按模块处理，保留业务 handler 与 API。PDA 范围等待用户偏好，默认先 ERP。

**Tech Stack:** React、TypeScript、Tailwind、Radix、React Query。

- [x] 盘点 routeRegistry 主入口及共用组件消费者，生成覆盖矩阵。
- [x] PageHeader/ActionBar/FilterCard/SectionCard/DataTable/Pagination/BaseCrudPage/Dialog：统一密度、换行、滚动与错误状态；保留列宽、排序、选择及表单提交。
- [x] QueryFormLayout：迁移已有双列查询弹窗，保证内容从顶部开始排列。
- [x] 采购与库存：商品身份集中展示、供应商宽表单、采购/调拨/采购退货商品行与详情。
- [x] 财务会计、报表审批、系统设置：通过共享组件统一外观，修整模块中不适配的独立表单/容器。
- [x] 以本地有效会话按模块验收主页面及代表性弹窗，记录具体页面与限制。
- [x] tsc、lint、单元测试、ERP/PDA 构建（共享基础组件有影响），diff 检查与文档同步。

界面验证只读和未保存草稿；不执行财务写入、库存动作、审批、导入、生产操作或物理打印。纯样式不新增映射实现的测试；交互行为改变时用有意义的回归验证。

覆盖与实测记录：`docs/erp-frontend-ui-2026-09-05.md`。这里完成的是 ERP 共用视觉结构及代表性专项重排；完整动态详情和各业务状态的逐项视觉验收仍按覆盖矩阵列明。
