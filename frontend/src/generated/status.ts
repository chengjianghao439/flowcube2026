/* eslint-disable */
// AUTO-GENERATED FILE. Do not edit manually.
// Source: backend/src/constants/warehouseTaskStatus.js, backend/src/constants/saleOrderStatus.js,
//         backend/src/constants/settlementType.js, backend/src/constants/documentStatusRules.js,
//         backend/src/constants/purchaseOrderStatus.js
// Regenerate with: node scripts/generate-status-constants.js

export type StatusTone = 'draft' | 'active' | 'success' | 'danger'

export const WT_STATUS = {
  "CANCELLED": 8,
  "CHECKING": 4,
  "PACKING": 5,
  "PENDING": 1,
  "PICKING": 2,
  "SHIPPED": 7,
  "SHIPPING": 6,
  "SORTING": 3
} as const
export type WtStatus = typeof WT_STATUS[keyof typeof WT_STATUS]
export const WT_STATUS_NAME = {
  "1": "待拣货",
  "2": "拣货中",
  "3": "待分拣",
  "4": "待复核",
  "5": "待打包",
  "6": "待出库",
  "7": "已出库",
  "8": "已取消"
} as const
export const WT_STATUS_TONE = {
  "1": "draft",
  "2": "active",
  "3": "active",
  "4": "active",
  "5": "active",
  "6": "active",
  "7": "success",
  "8": "danger"
} as const
export const WT_STATUS_ACTIVE = [
  1,
  2,
  3,
  4,
  5,
  6
] as const
export const WT_STATUS_PICK_POOL = [
  1,
  2
] as const
export const WT_STATUS_TERMINAL = [
  7,
  8
] as const
export const WT_TRANSITIONS = {
  "1": [
    2,
    8
  ],
  "2": [
    3,
    8
  ],
  "3": [
    4,
    8,
    2
  ],
  "4": [
    5,
    8,
    2
  ],
  "5": [
    6,
    8,
    2,
    4
  ],
  "6": [
    7,
    8,
    2,
    4
  ],
  "7": [],
  "8": []
} as const
export const WT_ACTION_RULES = {
  "adjustReopenChecking": {
    "allowed": [
      5,
      6
    ],
    "message": "内部动作：因改单退回分拣格，任务退回待复核",
    "toStatus": 4
  },
  "adjustReopenPicking": {
    "allowed": [
      3,
      4,
      5,
      6
    ],
    "message": "内部动作：因改单需要补拣，任务退回拣货中",
    "toStatus": 2
  },
  "assign": {
    "allowed": [
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "blocked": {
      "7": "已出库的任务不能修改",
      "8": "已取消的任务不能修改"
    }
  },
  "cancel": {
    "allowed": [
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "blocked": {
      "7": "已出库的任务不能取消",
      "8": "任务已取消"
    },
    "toStatus": 8
  },
  "checkDone": {
    "allowed": [
      4
    ],
    "message": "只有\"待复核\"状态可以完成复核",
    "toStatus": 5
  },
  "packDone": {
    "allowed": [
      5
    ],
    "message": "只有\"待打包\"状态可以完成打包",
    "toStatus": 6
  },
  "readyToShip": {
    "allowed": [
      2
    ],
    "message": "只有\"拣货中\"状态可以标记拣货完成",
    "toStatus": 3
  },
  "ship": {
    "allowed": [
      6
    ],
    "message": "只有\"待出库\"状态可以执行出库",
    "toStatus": 7
  },
  "sortTask": {
    "allowed": [
      3
    ],
    "message": "只有\"待分拣\"状态可以完成分拣",
    "toStatus": 4
  },
  "startPicking": {
    "allowed": [
      1,
      2
    ],
    "message": "只有\"待拣货\"或\"拣货中\"状态可以开始拣货"
  },
  "viewPickWork": {
    "allowed": [
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "blocked": {
      "7": "任务已完成或已取消",
      "8": "任务已完成或已取消"
    }
  }
} as const
export const WT_STATUS_OPTIONS = [
  {
    "label": "全部状态",
    "value": ""
  },
  {
    "label": "拣货中",
    "value": "2"
  },
  {
    "label": "待分拣",
    "value": "3"
  },
  {
    "label": "待复核",
    "value": "4"
  },
  {
    "label": "待打包",
    "value": "5"
  },
  {
    "label": "待出库",
    "value": "6"
  },
  {
    "label": "已出库",
    "value": "7"
  },
  {
    "label": "已取消",
    "value": "8"
  }
] as const
export const WT_KANBAN_COLUMNS = [
  {
    "accentClass": "bg-primary/10",
    "label": "拣货中",
    "status": 2
  },
  {
    "accentClass": "bg-yellow-500/10",
    "label": "待分拣",
    "status": 3
  },
  {
    "accentClass": "bg-purple-500/10",
    "label": "待复核",
    "status": 4
  },
  {
    "accentClass": "bg-orange-500/10",
    "label": "待打包",
    "status": 5
  },
  {
    "accentClass": "bg-cyan-500/10",
    "label": "待出库",
    "status": 6
  },
  {
    "accentClass": "bg-green-500/10",
    "label": "已出库",
    "status": 7
  },
  {
    "accentClass": "bg-red-500/5",
    "label": "已取消",
    "status": 8
  }
] as const

export const SALE_STATUS = {
  "CANCELLED": 5,
  "DRAFT": 1,
  "PARTIAL_RESERVED": 6,
  "PICKING": 3,
  "RESERVED": 2,
  "SHIPPED": 4
} as const
export type SaleStatus = typeof SALE_STATUS[keyof typeof SALE_STATUS]
export const SALE_STATUS_NAME = {
  "1": "草稿",
  "2": "已占库",
  "3": "拣货中",
  "4": "已出库",
  "5": "已取消",
  "6": "部分占库"
} as const
export const SALE_STATUS_TONE = {
  "1": "draft",
  "2": "active",
  "3": "active",
  "4": "success",
  "5": "danger",
  "6": "active"
} as const
export const SALE_STATUS_ACTIVE = [
  1,
  2,
  3,
  6
] as const
export const SALE_STATUS_TERMINAL = [
  4,
  5
] as const
export const SALE_ACTION_RULES = {
  "adjust": {
    "from": [
      2,
      3,
      6
    ],
    "message": "只有已占库/部分占库/拣货中的销售单可修改明细，已出库后不可修改"
  },
  "cancel": {
    "blocked": {
      "4": "已出库的订单不能取消",
      "5": "订单已取消"
    },
    "from": [
      1,
      2,
      3,
      6
    ],
    "message": "当前状态的订单不能取消",
    "to": 5
  },
  "completeShip": {
    "from": [
      3
    ],
    "message": "只有拣货中的销售单可以完成出库",
    "to": 4
  },
  "delete": {
    "from": [
      5
    ],
    "message": "只有已取消的订单可以删除"
  },
  "edit": {
    "from": [
      1
    ],
    "message": "只有草稿状态的销售单可以编辑"
  },
  "release": {
    "blocked": {
      "1": "草稿状态无需释放占库",
      "3": "拣货中的订单不能直接取消占库；请从销售订单发起取消，已拣实物需在原任务扫码归还",
      "4": "已出库的订单不能取消占库",
      "5": "订单已取消"
    },
    "from": [
      2,
      6
    ],
    "message": "只有已占库或部分占库的订单可以取消占库"
  },
  "reserve": {
    "from": [
      1,
      6
    ],
    "message": "只有草稿或部分占库状态可以占用库存"
  },
  "ship": {
    "from": [
      2,
      6
    ],
    "message": "只有已占库或部分占库的销售单可以发起出库",
    "to": 3
  }
} as const
export const SALE_STATUS_OPTIONS = [
  {
    "label": "全部状态",
    "value": ""
  },
  {
    "label": "草稿",
    "value": "1"
  },
  {
    "label": "已占库",
    "value": "2"
  },
  {
    "label": "拣货中",
    "value": "3"
  },
  {
    "label": "已出库",
    "value": "4"
  },
  {
    "label": "已取消",
    "value": "5"
  },
  {
    "label": "部分占库",
    "value": "6"
  }
] as const

export const PURCHASE_STATUS_NAME = {
  "1": "草稿",
  "2": "已提交",
  "3": "已完成",
  "4": "已取消",
  "5": "待审批"
} as const
export const PURCHASE_ACTION_RULES = {
  "approve": {
    "blocked": {
      "1": "采购单尚未提交",
      "2": "该采购单已确认，无需审批",
      "3": "采购单已完成",
      "4": "采购单已取消"
    },
    "from": [
      5
    ],
    "message": "只有待审批的采购单可以审批通过",
    "to": 2
  },
  "cancel": {
    "blocked": {
      "3": "已完成的采购单不能取消",
      "4": "采购单已取消"
    },
    "from": [
      1,
      2,
      5
    ],
    "message": "当前状态的采购单不能取消",
    "to": 4
  },
  "close": {
    "from": [
      2
    ],
    "message": "只有已提交的采购单可以关闭剩余结案",
    "to": 3
  },
  "complete": {
    "from": [
      2
    ],
    "message": "只有已提交的采购单可以完成",
    "to": 3
  },
  "confirm": {
    "from": [
      1
    ],
    "message": "只有草稿状态的采购单可以提交",
    "to": 2
  },
  "createInboundTask": {
    "from": [
      2
    ],
    "message": "只有已确认的采购单可创建入库任务"
  },
  "edit": {
    "from": [
      1
    ],
    "message": "只有草稿状态的采购单可以编辑"
  },
  "reject": {
    "blocked": {
      "1": "采购单尚未提交",
      "2": "该采购单已确认",
      "3": "采购单已完成",
      "4": "采购单已取消"
    },
    "from": [
      5
    ],
    "message": "只有待审批的采购单可以驳回",
    "to": 1
  },
  "reopen": {
    "from": [
      3
    ],
    "message": "只有已完成的采购单可以重新打开",
    "to": 2
  },
  "withdrawConfirm": {
    "from": [
      2,
      5
    ],
    "message": "只有已确认/待审批的采购单可以撤回",
    "to": 1
  }
} as const
export const PURCHASE_STATUS_OPTIONS = [
  {
    "label": "全部状态",
    "value": ""
  },
  {
    "label": "草稿",
    "value": "1"
  },
  {
    "label": "已提交",
    "value": "2"
  },
  {
    "label": "已完成",
    "value": "3"
  },
  {
    "label": "已取消",
    "value": "4"
  },
  {
    "label": "待审批",
    "value": "5"
  }
] as const

export const SUPPLIER_REFUND_STATUS = {
  "CANCELLED": 4,
  "CONFIRMED": 2,
  "DRAFT": 1,
  "RECEIVED": 3
} as const
export const SUPPLIER_REFUND_STATUS_NAME = {
  "1": "草稿",
  "2": "待收退款",
  "3": "已收退款",
  "4": "已取消"
} as const
export const SUPPLIER_REFUND_ACTION_RULES = {
  "cancel": {
    "from": [
      1,
      2
    ],
    "message": "已收退款不能取消，请财务核对",
    "to": 4
  },
  "confirm": {
    "from": [
      1
    ],
    "message": "只有草稿退款单可确认",
    "to": 2
  },
  "receive": {
    "from": [
      2
    ],
    "message": "只有待收退款单可登记收到",
    "to": 3
  }
} as const
export const SUPPLIER_REFUND_STATUS_OPTIONS = [
  {
    "label": "全部状态",
    "value": ""
  },
  {
    "label": "草稿",
    "value": "1"
  },
  {
    "label": "待收退款",
    "value": "2"
  },
  {
    "label": "已收退款",
    "value": "3"
  },
  {
    "label": "已取消",
    "value": "4"
  }
] as const

export const DISPOSAL_STATUS_NAME = {
  "1": "草稿",
  "2": "待审批",
  "3": "已批准",
  "4": "已处置",
  "5": "已驳回",
  "6": "已取消"
} as const
export const DISPOSAL_DISPLAY_LABEL = {
  "LEGACY_APPROVED": "待签认"
} as const
export const DISPOSAL_STATUS_OPTIONS = [
  {
    "label": "草稿",
    "value": "1"
  },
  {
    "label": "待审批",
    "value": "2"
  },
  {
    "label": "已批准",
    "value": "3"
  },
  {
    "label": "已处置",
    "value": "4"
  },
  {
    "label": "已驳回",
    "value": "5"
  },
  {
    "label": "已取消",
    "value": "6"
  }
] as const

export const SETTLEMENT_TYPE = {
  "CASH": 1,
  "MONTHLY": 2
} as const
export type SettlementType = typeof SETTLEMENT_TYPE[keyof typeof SETTLEMENT_TYPE]
export const SETTLEMENT_TYPE_NAME = {
  "1": "现结",
  "2": "月结"
} as const
export const SETTLEMENT_TYPE_TONE = {
  "1": "warning",
  "2": "active"
} as const
export const MONTHLY_TERMS_OPTIONS = [
  30,
  60,
  90
] as const
export const IMMEDIATE_SETTLEMENT_TYPES = [
  1
] as const
export const SETTLEMENT_TYPE_OPTIONS = [
  {
    "label": "现结",
    "value": "1"
  },
  {
    "label": "月结",
    "value": "2"
  }
] as const

