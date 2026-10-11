// 采购自身的状态文案；仅集中原有定义，不改变状态迁移或审批规则。
const PURCHASE_STATUS_NAME = Object.freeze({ 1: '草稿', 2: '已提交', 3: '已完成', 4: '已取消', 5: '待审批' })
module.exports = { PURCHASE_STATUS_NAME }
