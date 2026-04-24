/* eslint-disable */
// AUTO-GENERATED FILE. Do not edit manually.
// Source: backend/src/constants/warehouseTaskStatus.js, backend/src/constants/saleOrderStatus.js
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
    2
  ],
  "2": [
    3,
    8
  ],
  "3": [
    4,
    8
  ],
  "4": [
    5,
    8
  ],
  "5": [
    6,
    8
  ],
  "6": [
    7,
    8
  ],
  "7": [],
  "8": []
} as const
export const WT_ACTION_RULES = {
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
  "5": "已取消"
} as const
export const SALE_STATUS_TONE = {
  "1": "draft",
  "2": "active",
  "3": "active",
  "4": "success",
  "5": "danger"
} as const
export const SALE_STATUS_ACTIVE = [
  1,
  2,
  3
] as const
export const SALE_STATUS_TERMINAL = [
  4,
  5
] as const
export const SALE_ACTION_RULES = {
  "cancel": {
    "blocked": {
      "4": "已出库的订单不能取消",
      "5": "订单已取消"
    },
    "from": [
      1,
      2,
      3
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
    "from": [
      2
    ],
    "message": "只有已占库的订单可以取消占库",
    "to": 1
  },
  "reserve": {
    "from": [
      1
    ],
    "message": "只有草稿状态可以占用库存",
    "to": 2
  },
  "ship": {
    "from": [
      2
    ],
    "message": "只有已占库的销售单可以发起出库",
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
  }
] as const

