// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import client, { setApiClientBaseURL } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { TabPathContext } from '@/components/layout/TabPathContext';
import SupplierRefundPage, { SupplierRefundCreatePage } from './index';
import { readRefundRecords, REFUND_STORAGE } from '@/lib/supplierRefundRecovery';
import { APPROVAL_BUSINESS, approvalSource, pendingApprovalAmount } from '@/lib/approvalBusiness';
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta';
import { routeRegistry } from '@/router/routeDefinitions';
const originalAdapter = client.defaults.adapter, unknown: string[] = [], calls: InternalAxiosRequestConfig[] = [];
const source = { purchaseReturnId: 11, returnNo: 'PR11', purchaseOrderId: 10, orderNo: 'PO10', supplierId: 4, warehouseId: 8, paymentRecordId: 31, currentPaidAmount: '100.0000', grossAmount: '6.0000', availableAmount: '6.0000', items: [{ id: 12, purchaseItemId: 101, productId: 3, unit: '个', quantity: '2.00', unitPrice: '3.0000' }], entries: [{ entryId: 21, recordId: 31, receiptId: null, originalAmount: '100.0000', availableAmount: '100.0000', paymentDate: '2026-10-01', receipt: null, out: { id: 51, bizNo: 'PO10', amount: '100.0000' } }] };
const detail = { id: 61, refund_no: 'RF61', purchase_return_id: 11, purchase_order_id: 10, payment_record_id: 31, supplier_id: 4, warehouse_id: 8, income_account_id: 42, amount: '0.0049', refund_date: '2026-10-01', status: 1, created_by: 8, confirmAllowed: true, source_fingerprint: 'actual-fingerprint', fund_transaction_id: null, voucher_id: null, voucher_generate_error: null, allocations: [{ entry_id: 21, receipt_id: null, amount: '0.0049', budget_state: 'draft' }] };
let status = 1, confirmAllowed = true, delaySource: Promise<void> | null = null, voucherError: string | null = null, oldVoucher: number | null = null;
const response = (c: InternalAxiosRequestConfig, data: unknown) => ({ config: c, headers: {}, status: 200, statusText: 'OK', data: { success: true, data } });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); calls.length = 0; unknown.length = 0; status = 1; confirmAllowed = true; delaySource = null; voucherError = null; oldVoucher = null; setApiClientBaseURL('/a'); useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: ['supplier.refund.view', 'supplier.refund.create', 'supplier.refund.confirm', 'supplier.refund.receive', 'purchase.order.view', 'return.order.view', 'payment.view', 'finance.account.view'] }); useWorkspaceStore.setState({ tabs: [], activeKey: '/supplier-refunds' }); client.defaults.adapter = async (c) => { calls.push(c); if (c.method === 'get' && c.url === '/supplier-refunds') {
    expect(c.params).toEqual({ page: 1, pageSize: 20 });
    return response(c, { list: [{ ...detail, status }], total: 1, page: 1, pageSize: 20 });
} if (c.method === 'get' && c.url === '/supplier-refunds/source') {
    expect(c.params).toEqual({ purchaseReturnId: 11 });
    if (delaySource)
        await delaySource;
    return response(c, source);
} if (c.method === 'get' && c.url === '/supplier-refunds/61')
    return response(c, { ...detail, status, confirmAllowed, voucher_generate_error: voucherError, voucher_id: oldVoucher }); if (c.method === 'get' && c.url === '/finance/accounts/active')
    return response(c, [{ id: 42, name: '收入账户', isActive: true }]); if (c.method === 'post' && c.url === '/supplier-refunds')
    throw Error('uncertain create'); if (c.method === 'post' && c.url === '/supplier-refunds/61/confirm')
    return response(c, { id: 61, refundNo: 'RF61', status: 2 }); if (c.method === 'get' && /^\/supplier-refunds\/operations\//.test(c.url || ''))
    return response(c, { status: 'not_found' }); unknown.push(`${c.method} ${c.url}`); throw Error('unknown endpoint'); }; });
afterEach(() => { vi.restoreAllMocks(); client.defaults.adapter = originalAdapter; localStorage.clear(); expect(unknown).toEqual([]); });
async function mount(path: string, create = false) { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); let tab = path; const render = async () => { await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><TabPathContext.Provider value={tab}>{create ? <SupplierRefundCreatePage /> : <SupplierRefundPage />}</TabPathContext.Provider></MemoryRouter></QueryClientProvider>); await new Promise(r => setTimeout(r, 15)); }); }; await render(); await act(async () => { await new Promise(r => setTimeout(r, 20)); }); return { host, qc, render, setTab: (p: string) => { tab = p; }, close: async () => { await act(async () => root.unmount()); qc.clear(); host.remove(); } }; }
const buttons = (text: string) => Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.includes(text));
async function click(text: string) { const b = buttons(text).find(b => !b.disabled); expect(b, `active button ${text}`).toBeTruthy(); await act(async () => { b!.click(); await new Promise(r => setTimeout(r, 15)); }); }
async function fill(label: string, value: string) { const input = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement; expect(input).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }); }
test('准确PR原价/4位预算和原付款分配，实际页面POSTunknown持久完整体且不改原日期/重发', async () => { const m = await mount('/supplier-refunds/new?purchaseReturnId=11', true); try {
    expect(m.host.textContent).toContain('PR11');
    expect(m.host.textContent).toContain('3.0000');
    await fill('真实银行回款日', '2026-10-01');
    await fill('原付款分配21退款金额', '0.0049');
    await fill('收入账户', '42');
    await click('保存退款草稿');
    expect((document.querySelector('[aria-label="原付款分配21退款金额"]') as HTMLInputElement)?.value).toBe('0.0049');
    expect(document.body.textContent).toContain('原请求退款合计');
    expect(readRefundRecords()[0].body).toMatchObject({ purchaseReturnId: 11, incomeAccountId: 42, refundDate: '2026-10-01', amount: '0.0049', allocations: [{ entryId: 21, amount: '0.0049' }] });
    await click('查询原结果');
    expect(calls.filter(c => c.method === 'post')).toHaveLength(1);
    expect(readRefundRecords()[0].refundDate).toBe('2026-10-01');
}
finally {
    await m.close();
} });
test('已创建原回执仍呈现提交的四位金额和原分配，不显示为零或重新提交', async () => {
 const adapter=client.defaults.adapter as (c:InternalAxiosRequestConfig)=>Promise<unknown>
 client.defaults.adapter=async c=>c.method==='post'&&c.url==='/supplier-refunds'?response(c,{id:61,refundNo:'RF61',status:1}):adapter(c) as never
 const m=await mount('/supplier-refunds/new?purchaseReturnId=11',true)
 try {
  await fill('真实银行回款日','2026-10-01');await fill('收入账户','42');await fill('原付款分配21退款金额','0.0049');await click('保存退款草稿')
  expect(document.body.textContent).toContain('RF61');expect(document.body.textContent).toContain('¥0.0049')
  expect((document.querySelector('[aria-label="原付款分配21退款金额"]') as HTMLInputElement)?.value).toBe('0.0049')
  expect(buttons('保存退款草稿').every(b=>b.disabled)).toBe(true)
 }finally{await m.close()}
})
test.each([1, 2, 3, 4])('状态%d准确detail动作，state3不撤销，确认只RF1与真实confirmAllowed', async (value) => { status = value; const m = await mount('/supplier-refunds?detailId=61'); try {
    expect(document.body.textContent).toContain('RF61');
    expect(buttons('确认退款单').some(b => !b.disabled)).toBe(value === 1);
    expect(buttons('登记实际已收到').some(b => !b.disabled)).toBe(value === 2);
    expect(buttons('取消退款单').some(b => !b.disabled)).toBe([1, 2].includes(value));
    expect(document.body.textContent).toContain('0.0049');
}
finally {
    await m.close();
} });
test('自身flag0/缺confirmAllowed不提供确认，撤完整VIEW不继续source/detail读取仍有本人原GET', async () => { confirmAllowed = false; const m = await mount('/supplier-refunds?detailId=61'); try {
    expect(buttons('确认退款单').some(b => !b.disabled)).toBe(false);
    await act(async () => useAuthStore.getState().updateUser({ permissions: ['supplier.refund.confirm'] }));
    await m.render();
    expect(document.body.textContent).toContain('完整原单查看权限');
    expect(calls.filter(c => c.url === '/supplier-refunds/61')).toHaveLength(1);
}
finally {
    await m.close();
} });
test('准确draft identity保空值/重复且原客户退款title/path不改，RF待办导航及四位，旧两位保持', () => { expect(APPROVAL_BUSINESS.supplier_refund.path(61)).toBe('/supplier-refunds?detailId=61'); expect(approvalSource('supplier_refund', 61, () => true).label).toBe('供应商退款'); expect(pendingApprovalAmount({ bizType: 'supplier_refund', amount: 0.0049 } as never)).toContain('0.0049'); expect(pendingApprovalAmount({ bizType: 'purchase_order', amount: 0.0049 } as never)).toContain('0.00'); expect(routeRegistry.find(r => r.path === '/refunds')?.title).toBe('退货退款单'); expect(buildWorkspaceTabRegistrationFromPath('/supplier-refunds/new?purchaseReturnId=&purchaseReturnId=11').path).toContain('purchaseReturnId='); });
test('缺收入账户VIEW零账户GET，storage损坏零POST，不覆盖已有输入', async () => { useAuthStore.getState().updateUser({ permissions: ['supplier.refund.view', 'supplier.refund.create', 'purchase.order.view', 'return.order.view', 'payment.view'] }); localStorage.setItem(REFUND_STORAGE, 'corrupt'); const m = await mount('/supplier-refunds/new?purchaseReturnId=11', true); try {
    expect(calls.some(c => c.url === '/finance/accounts/active')).toBe(false);
    expect(document.body.textContent).toContain('账户查看权限');
    expect(calls.some(c => c.method === 'post')).toBe(false);
}
finally {
    await m.close();
} });
import RefundRecoveryPage from './RefundRecoveryPage';
import { captureRefundOwner, saveRefundRecord } from '@/lib/supplierRefundRecovery';
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard';
test('实际详情旧正voucherId加新error仍待核对，零分只合法proof文案', async () => { status = 3; oldVoucher = 55; voucherError = '新投影未核对'; const m = await mount('/supplier-refunds?detailId=61'); try {
    expect(document.body.textContent).toContain('回款已登记，凭证待核对');
    expect(document.body.textContent).not.toContain('凭证已生成');
}
finally {
    await m.close();
} });
test('AuthOnly恢复page切owner/服务器隐藏旧RFheading，合法本人GET不加载详情/source/账户', async () => {
    const owner = captureRefundOwner();
    saveRefundRecord({ version: 1, userId: 9, baseURL: owner.baseURL, sessionGeneration: owner.sessionGeneration, epoch: owner.epoch, activeGeneration: 0, createdAt: 1, method: 'post', phase: 'pending', kind: 'receive', draftIdentity: 'supplier-refund:61:receive', refundId: 61, path: '/supplier-refunds/61/receive', action: 'supplier.refund.receive.61', operationUuid: '22222222-2222-4222-8222-222222222222', requestKey: 'fixed-key', refundDate: '2026-10-01', sourceFingerprint: 'exact', source: { purchaseReturnId: 11, purchaseOrderId: 10, paymentRecordId: 31, supplierId: 4, warehouseId: 8, incomeAccountId: 42, amount: '0.0049' }, body: { operationUuid: '22222222-2222-4222-8222-222222222222' } });
    useAuthStore.getState().updateUser({ permissions: [] });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
        await act(async () => root.render(<MemoryRouter initialEntries={['/supplier-refunds/recovery']}><QueryClientProvider client={qc}><RefundRecoveryPage /></QueryClientProvider></MemoryRouter>));
        expect(host.textContent).toContain('退款单 61');
        await click('查询原结果');
        expect(calls.map(c => c.url)).toEqual(['/supplier-refunds/operations/22222222-2222-4222-8222-222222222222']);
        await act(async () => setApiClientBaseURL('/b'));
        expect(host.textContent).not.toContain('退款单 61');
        await act(async () => setApiClientBaseURL('/a'));
        expect(host.textContent).toContain('退款单 61');
        await act(async () => useAuthStore.getState().updateUser({ id: 10 }));
        expect(host.textContent).not.toContain('退款单 61');
    }
    finally {
        await act(async () => root.unmount());
        qc.clear();
        host.remove();
    }
});
test('实际KeepAlive/registry preserves退款草稿输入及同key原path，无默认未知API', async () => {
    let navigate!: NavigateFunction;
    function Harness() { navigate = useNavigate(); return <KeepAliveOutlet />; }
    const createPath = '/supplier-refunds/new?purchaseReturnId=11', registration = buildWorkspaceTabRegistrationFromPath(createPath);
    useWorkspaceStore.setState({ tabs: [{ ...registration, title: '供应商退款', closable: true }], activeKey: registration.key });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const settle = async () => { for (let i = 0; i < 8; i++)
        await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
    try {
        await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[createPath]}><Harness /></MemoryRouter></QueryClientProvider>));
        await settle();
        await fill('真实银行回款日', '2026-10-01');
        await fill('原付款分配21退款金额', '0.0049');
        await fill('收入账户', '42');
        await act(async () => navigate('/supplier-refunds'));
        await settle();
        await act(async () => navigate(createPath));
        await settle();
        expect((host.querySelector('[aria-label="真实银行回款日"]') as HTMLInputElement).value).toBe('2026-10-01');
        expect((host.querySelector('[aria-label="原付款分配21退款金额"]') as HTMLInputElement).value).toBe('0.0049');
        expect(useWorkspaceStore.getState().tabs.find(t => t.key === registration.key)?.path).toBe(createPath);
        expect(calls.filter(c => c.method === 'post')).toEqual([]);
    }
    finally {
        await act(async () => root.unmount());
        disposeWorkspaceHistoryGuard();
        qc.clear();
        host.remove();
    }
});
