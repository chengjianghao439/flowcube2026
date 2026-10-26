import { collectList } from './pagination.js';
// 工具注册表（契约见《极序Agent-工具契约-MVP14》）。
// 注册表之外无接口可调；新增工具必须同步契约与评估集。
// 每个工具：{ name, level: 'L1'|'L2', run(client, args) }，run 只返回结构化事实。

const q = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

export const TOOLS = {
  'search.global': {
    level: 'L1', desc: '全局搜索：商品/客户/供应商/单据消歧定位',
    requires: 'dashboard.view',
    async run(c, { keyword, type } = {}) {
      const data = await c.get(`/api/search/?${q({ q: keyword })}`);
      const hits = Array.isArray(data) ? data : (data?.list ?? []);
      return { hits: type ? hits.filter(h => h.type === type) : hits };
    },
  },

  'inventory.query_by_product': {
    level: 'L1', desc: '按商品查库存：现存以 ACTIVE 容器实存为准',
    requires: 'inventory.view',
    async run(c, { productId, warehouseId }) {
      const data = await c.get(`/api/inventory/query-by-product?${q({ productId, warehouseId })}`);
      const containers = data?.containers ?? [];
      const active = containers; // 服务端仅返回 ACTIVE 容器，锁定信息保留
      const onHand = containers.reduce((s, x) => s + Number(x.remainingQty || 0), 0);
      return {
        productId: data?.productId ?? productId, productName: data?.productName ?? null,
        unit: data?.unit ?? null, onHand, containers: active,
        basis: 'ACTIVE容器实存合计（服务端返回明细）', asOf: new Date().toISOString(),
        raw: data,
      };
    },
  },

  'inventory.containers': {
    level: 'L1', desc: '容器明细：货在哪个容器/库位',
    requires: 'inventory.view',
    async run(c, { productId, warehouseId }) {
      const data = await c.get(`/api/inventory/containers?${q({ productId, warehouseId, page: 1, pageSize: 100 })}`);
      const list = Array.isArray(data) ? data : (data?.list ?? []);
      return { containers: list, totalQty: list.reduce((s, x) => s + Number(x.remainingQty || 0), 0) };
    },
  },

  'inventory.reservations': {
    level: 'L1', desc: '占库查询：可用量被哪些单占了',
    requires: 'inventory.view',
    async run(c, { productId, warehouseId }) {
      const data = await c.get(`/api/inventory/reservations?${q({ productId, warehouseId })}`);
      return { reservations: Array.isArray(data) ? data : (data?.list ?? data ?? []) };
    },
  },

  'inventory.replenishment': {
    level: 'L1', desc: '补货建议与低库存（与仪表盘同口径）',
    requires: 'report.view',
    async run(c, { warehouseId } = {}) {
      const [replenishment, lowStock] = await Promise.allSettled([
        collectList(c, '/api/inventory/replenishment', warehouseId == null ? {} : { warehouseId: String(warehouseId) }),
        c.get(`/api/dashboard/low-stock`),
      ]);
      // 主建议读取失败不能等同于成功的空集合；低库存仅是补充信息。
      if (replenishment.status === 'rejected') throw replenishment.reason;
      return {
        replenishment: replenishment.value,
        lowStock: lowStock.status === 'fulfilled' ? lowStock.value : null,
        errors: [replenishment, lowStock].filter(r => r.status === 'rejected').map(r => r.reason?.message),
      };
    },
  },

  'sale.reserve_preview': {
    level: 'L1', desc: '已有销售单的试占库（零写入）',
    requires: 'sale.order.reserve',
    async run(c, { saleOrderId }) {
      return c.get(`/api/sale/${saleOrderId}/reserve-preview`);
    },
  },

  'payments.party_ledger': {
    level: 'L1', desc: '往来台账：type 2=客户应收 / 1=供应商应付，严禁混查',
    requires: 'payment.view',
    async run(c, { partyType, partyId }) {
      const type = partyType === 'customer' ? 2 : 1;
      const data = await c.get(`/api/payments/party-ledger?${q({ type, partyId, page: 1, pageSize: 50 })}`);
      return { partyType, partyId, ledger: data };
    },
  },

  'tasks.progress': {
    level: 'L1', desc: '作业进度与卡点：出库/收货/退货任务',
    async run(c, { warehouseId } = {}) {
      const [stats, binPending, inbound, returns] = await Promise.allSettled([
        c.get(`/api/warehouse-tasks/stats?${q({ warehouseId })}`),
        c.get(`/api/warehouse-tasks/sorting-bin-pending?${q({ warehouseId })}`),
        c.get(`/api/inbound-tasks/?${q({ warehouseId, page: 1, pageSize: 20 })}`),
        Promise.reject(new Error('当前接口不支持完整退货任务汇总，请到退货页面核对')),
      ]);
      const pick = r => (r.status === 'fulfilled' ? r.value : null);
      return {
        warehouseTaskStats: pick(stats), sortingBinPending: pick(binPending),
        inboundTasks: pick(inbound), returnTasks: pick(returns),
        errors: [stats, binPending, inbound, returns].filter(r => r.status === 'rejected').map(r => r.reason?.message),
      };
    },
  },

  'print.diagnose': {
    level: 'L1', desc: '打印卡点诊断：绑定与任务状态（两类失败分开）',
    requires: 'print.job.view',
    async run(c, { warehouseId } = {}) {
      const [jobs, bindings] = await Promise.allSettled([
        c.get(`/api/print-jobs/?${q({ warehouseId, page: 1, pageSize: 20 })}`),
        c.get(`/api/printer-bindings/?${q({ warehouseId })}`),
      ]);
      return {
        jobs: jobs.status === 'fulfilled' ? jobs.value : null,
        bindings: bindings.status === 'fulfilled' ? bindings.value : null,
        errors: [jobs, bindings].filter(r => r.status === 'rejected').map(r => r.reason?.message),
      };
    },
  },

  'approvals.pending': {
    level: 'L1', desc: '待审批查询（只查不批）',
    requires: 'approval.task.view',
    async run(c) { return c.get(`/api/approvals/pending`); },
  },

  'dashboard.briefing': {
    level: 'L1', desc: '经营简报聚合：每段带口径与时点，取数失败段落标注不补位',
    requires: 'dashboard.view',
    async run(c) {
      const parts = {
        summary: c.get('/api/dashboard/summary'),
        lowStock: c.get('/api/dashboard/low-stock'),
        creditWarning: c.get('/api/dashboard/credit-warning'),
        incomingPurchases: c.get('/api/dashboard/incoming-purchases'),
        pendingApprovals: c.get('/api/approvals/pending'),
      };
      const out = { asOf: new Date().toISOString(), sections: {} };
      // 所有并行请求立即挂上拒绝处理；逐个 await 会使后段的先行拒绝终止进程。
      const results = await Promise.allSettled(Object.values(parts));
      Object.keys(parts).forEach((key, index) => {
        const result = results[index];
        out.sections[key] = result.status === 'fulfilled'
          ? { ok: true, data: result.value }
          : { ok: false, error: result.reason?.message || '取数失败' };
      });
      return out;
    },
  },

  // ---------- L2 写工具：只能经任务图的确认点调用 ----------

  'sale.create_draft': {
    level: 'L2', desc: '建销售单草稿（幂等键必传）；核验=回查单据',
    requires: 'sale.order.create',
    async run(c, { payload, requestKey }) {
      const created = await c.post('/api/sale/', payload, { requestKey });
      const id = created?.id ?? created?.order?.id;
      let verified = null, verificationError = null;
      if (id) { try { verified = await c.get(`/api/sale/${id}`); } catch (e) { verificationError = e.message; } }
      return { created, verified, verificationError };
    },
  },

  'sale.reserve': {
    level: 'L2', desc: '销售单占库（独立确认）；核验=回查预占',
    requires: 'sale.order.reserve',
    async run(c, { saleOrderId, requestKey }) {
      const result = await c.post(`/api/sale/${saleOrderId}/reserve`, {}, { requestKey });
      let verified = null, verificationError = null;
      try { verified = await c.get(`/api/sale/${saleOrderId}`); } catch (e) { verificationError = e.message; }
      return { result, verified, verificationError };
    },
  },

  'purchase.create_draft': {
    level: 'L2', desc: '建采购单草稿（只到草稿，confirm/approve 不在 Agent 内）',
    requires: 'purchase.order.create',
    async run(c, { payload, requestKey }) {
      const created = await c.post('/api/purchase/', payload, { requestKey });
      const id = created?.id;
      let verified = null, verificationError = null;
      if (id) { try { verified = await c.get(`/api/purchase/${id}`); } catch (e) { verificationError = e.message; } }
      return { created, verified, verificationError };
    },
  },

  'payments.receipt_suggest': {
    level: 'L2', desc: '收款核销（图 D 两段确认）：候选=未结应收账款，登记收款与核销分配分两步',
    requires: 'payment.view',
    // 核销候选：该客户未结应收账款（status=unsettled 即 status 1/2 且 balance>0）。
    // 注：/api/payments/statements/candidates 是「月结组对账单」的候选口径（按 partyName 查月结账款），
    // 不是核销候选源；核销分配最终落到 payment_records，候选以未结账款列表为准（契约 14 已同步）。
    async candidates(c, { customerId } = {}) {
      const data = await collectList(c, '/api/payments/', { type: '2', partyId: String(customerId), status: 'unsettled' });
      if (data.list.some(r => ['totalAmount', 'paidAmount', 'balance'].some(k => r[k] != null && Math.abs(Number(r[k]) * 100 - Math.round(Number(r[k]) * 100)) > 1e-6))) throw new Error('账款含不足一分的历史金额，请到原页面核对后办理，不自动舍入或登记收款');
      if (data.summary?.balance != null && Math.abs(data.list.reduce((s, r) => s + Number(r.balance), 0) - Number(data.summary.balance)) > 0.001) throw new Error('账款明细与服务端余额不一致，请重新查询');
      return data.list;
    },
    // 该客户全部应收账款（含已结清），供核销后逐笔回查核验
    async records(c, { customerId } = {}) {
      return (await collectList(c, '/api/payments/', { type: '2', partyId: String(customerId) })).list;
    },
    // 可用资金账户（登记收款必选入账账户；无账户时上层停步引导建账）
    async accounts(c) {
      const data = await c.get('/api/finance/accounts/active');
      return Array.isArray(data) ? data : (data?.list ?? []);
    },
    async detail(c, { receiptId }) {
      return c.get(`/api/payments/receipts/${receiptId}`);
    },
    // 登记收款（图 D 第一段）：payload 不带 allocations = 先挂账，核销在第二段单独确认
    async run(c, { payload, requestKey }) {
      const created = await c.post('/api/payments/receipts', payload, { requestKey });
      return { created };
    },
    // 核销分配（图 D 第二段）：allocations [{recordId, amount}]，后端同键幂等、重放回原结果
    async settle(c, { receiptId, allocations, requestKey }) {
      const result = await c.post(`/api/payments/receipts/${receiptId}/settle`, { allocations }, { requestKey });
      return { result };
    },
  },
};

export function getTool(name) {
  const t = TOOLS[name];
  if (!t) throw new Error(`工具未注册：${name}`);
  return t;
}
