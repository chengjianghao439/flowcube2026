# 顺丰、德邦月结自动下单实施计划

**目标：** 沿用已有月结账号直连顺丰、德邦官方下单接口，避免购买聚合平台下单套餐。接口是否额外收费以各自开通协议为准，不承诺永久免费。

**架构：** 打包事务只保存运单与寄收件快照；物流 worker 在事务外调用官方接口。整批按实际箱数拆为最多 30 箱的批次，每批一个稳定订单号；结果不明只查原单，尤其禁止德邦大客户模式重复 create（官方允许同渠道号追加子件）。凭据仅从服务端环境读取。

**技术：** Node 22 / CommonJS / fetch、MySQL 增量迁移、React / TypeScript、node:test。

## 依据与已知前提

- 用户已有顺丰、德邦月结账号，授权本地实现，未授权发布或实际付费寄件。
- 顺丰：官方《丰桥平台新API接口规范》及 PHP SDK V2.1.1 签名说明；下单 `EXP_RECE_CREATE_ORDER`，结果查询 `EXP_RECE_SEARCH_ORDER_RESP`。
- 德邦：`https://dop.deppon.com/#/apiDocs/apiDetail/CREATE_ORDER_NOTIFY`、`QUERY_ORIGINAL_ORDER`，签名规范 `#/apiDocs/accessGuide/apiSDKUsageInfo`。正式 URL 和查询权限由德邦开通后分配。
- 用户最新明确两家下单重量默认填 1；系统不采集重量，顺丰与德邦对应下单字段均默认传 1（kg），最终实重仍由快递员称重确认。旧省略/零值配置及其开通前置条件取消。
- 本机没有 WAYBILL 凭据配置；先完成离线合同测试，真实账号联调需开通凭据。

## 执行步骤（当前会话顺序执行，保留既有未提交改动）

- [x] 编写 `tests/direct-express.test.js`：官方签名、完整请求、支付映射、产品必填、响应真实性、HTTP 超时、重复下单保护、查单归属；先运行 `node --test tests/direct-express.test.js` 确认失败。
- [x] 新增 `backend/src/modules/logistics/carrier-adapters/{direct-common,sf,deppon}.js`；注册两家适配器并扩展 `config/env.js` 的凭据组（只读环境，不改真实 .env）。
- [x] 新增迁移 `237_direct_express.sql`：承运商产品/送货方式、运单寄收件和请求快照。新增 `logistics.direct.js` 隔离请求准备、领取、查询恢复。
- [x] 接通打包快照、worker、运单资料修改和安全重试。未知结果显示待核实；自动查询不能重新创建；已发送的直连单不允许通过原本只改本地状态的作废入口伪装成平台取消。
- [x] 承运商页增加官方平台与产品设置，运单页增加寄收件表单（件数只读，无重量输入）、下单结果核实入口；移除未实现的菜鸟选项。
- [x] 补充配置检查脚本及开通操作文档，同步 AGENTS.md 与旧设计文档中的幂等假设。
- [x] 运行新增单元回归、受影响 lint、前端类型检查与页面验证。核对 diff，说明凭据/真实寄件/官方面单打印的验收边界，不自动发布。

真实平台凭据与寄件联调不在离线完成项中，仍待账号开通；没有发布或创建真实快递订单。

本地迁移、26项离线回归、独立MySQL回归、前端校验与真实本地页面保存已验证；独立复核发现的缩批恢复问题已修正。详细证据与边界见 `docs/direct-express-2026-09-06.md`。
