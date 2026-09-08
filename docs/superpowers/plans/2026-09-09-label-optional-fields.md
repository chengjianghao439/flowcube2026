# 条码标签可选字段扩展

范围：type 5–10 增加可拖拽信息，保留现有默认布局。预览与打印共用取值，缺失值留空，无迁移、无真机打印、无发布。

- [x] 后端：共享标签取值，接入入队与真实数据预览；同事务读取容器/装箱数据。
- [x] 前端：按类型补充字段、示例值，默认布局不变。
- [x] 验证：数据库字段与打印 ZPL、仓库权限、事务内新容器；前端测试、类型检查、实际页面。
- [x] 文档：AGENTS 现行规则与字段清单，独立规格和质量审查。

字段契约：
- 5：warehouse_name, warehouse_code, max_levels, max_positions, remark。
- 6/9：product_code, article_number, spec, color, unit, warehouse_name, warehouse_code, location_code, batch_no, mfg_date, exp_date；9 同时加 qty。
- 7：sale_order_no, warehouse_name, warehouse_code, remark。
- 8：article_number, color（已有 spec/unit/price）。
- 10：warehouse_name, warehouse_code, aisle, rack, level, position, remark。
