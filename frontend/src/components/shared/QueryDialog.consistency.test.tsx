// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { getByRole } from '@testing-library/dom'
import RefundQueryDialog from '@/pages/refunds/RefundQueryDialog'
import VoucherQueryDialog from '@/pages/accounting/vouchers/VoucherQueryDialog'
import { PaymentQueryDialog } from './PaymentQueryDialog'
import { EMPTY_PAYMENT_QUERY } from './paymentQuery'
import { QueryDialog } from './QueryDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
afterEach(() => { for (const { host, root } of mounted.splice(0)) { act(() => root.unmount()); host.remove() } })
function draw(view: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  act(() => root.render(view)); return root
}

test.each(['refund', 'voucher'] as const)('%s查询与其他查询一致：打开直达文本条件，不自动应用', kind => {
  const apply = vi.fn(), close = vi.fn()
  if (kind === 'refund') draw(<RefundQueryDialog open initial={{ keyword:'', status:'', startDate:'2026-10-18', endDate:'2026-10-24' }} onClose={close} onApply={apply} />)
  else draw(<VoucherQueryDialog open initial={{ keyword:'', status:'', sourceType:'', period:'202610' }} onClose={close} onApply={apply} />)
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
  expect(document.activeElement).toBe(input)
  expect(apply).not.toHaveBeenCalled()
  act(() => getByRole(document.body, 'button', { name:'取消' }).click())
  expect(close).toHaveBeenCalledTimes(1)
})

test('账款查询的字段有明确名称；清空只改变草稿，查询沿原值应用并关闭', () => {
  const apply = vi.fn(), close = vi.fn()
  draw(<PaymentQueryDialog open initial={{ ...EMPTY_PAYMENT_QUERY, docNo:'DEMO-APPLIED' }} onClose={close} onApply={apply} partyType={1} labels={{docLabel:'关联单号',partyLabel:'供应商',statusText:v=>v,dateLabel:'创建日期',amountLabel:'账款金额'}} statusOptions={[]} clearValue={{...EMPTY_PAYMENT_QUERY, status:'unsettled'}} />)
  expect((getByRole(document.body, 'textbox', { name:'关联单号' }) as HTMLInputElement).value).toBe('DEMO-APPLIED')
  getByRole(document.body, 'spinbutton', { name:'账款金额（最小值）' })
  getByRole(document.body, 'spinbutton', { name:'账款金额（最大值）' })
  act(() => getByRole(document.body, 'button', { name:'清空' }).click())
  expect(apply).not.toHaveBeenCalled()
  act(() => getByRole(document.body, 'button', { name:'查询' }).click())
  expect(apply).toHaveBeenCalledExactlyOnceWith({...EMPTY_PAYMENT_QUERY,status:'unsettled'})
  expect(close).toHaveBeenCalledTimes(1)
})

test('纯选择查询聚焦可用条件，不因日期输入打开日历', () => {
  const calendar = vi.fn(), apply = vi.fn()
  draw(<QueryDialog open dialogId="selection-query" title="查询库存" onClose={() => {}} onReset={() => {}} onApply={apply}>
    <div className="fc-date-picker"><input aria-label="业务日期" onFocus={calendar} /></div>
    <button>选择仓库</button>
  </QueryDialog>)
  expect(document.activeElement).toBe(getByRole(document.body, 'button', { name:'选择仓库' }))
  expect(calendar).not.toHaveBeenCalled()
  expect(apply).not.toHaveBeenCalled()
})


test('查询弹窗只有一处标题下说明，原提示优先，否则按查询对象说明用途', () => {
  const close = vi.fn(), apply = vi.fn(), reset = vi.fn()
  const root = draw(<QueryDialog open dialogId="caption-query" title="查询采购单" onClose={close} onApply={apply} onReset={reset}><input aria-label="单号" /></QueryDialog>)
  const dialog = getByRole(document.body, 'dialog')
  expect(dialog.querySelectorAll('.fc-dialog-caption')).toHaveLength(1)
  expect(dialog.querySelector('.fc-app-dialog-header .fc-dialog-caption')?.textContent).toContain('采购单')
  act(() => root.render(<QueryDialog open dialogId="caption-query" title="查询采购单" description="日期清空后按全部期间查询。" onClose={close} onApply={apply} onReset={reset}><input aria-label="单号" /></QueryDialog>))
  expect(dialog.querySelector('.fc-dialog-caption')?.textContent).toBe('日期清空后按全部期间查询。')
  expect(dialog.textContent?.match(/日期清空后/g)).toHaveLength(1)
  act(() => getByRole(dialog, 'button', { name: '重置' }).click())
  expect(reset).toHaveBeenCalledTimes(1)
  expect(apply).not.toHaveBeenCalled()
})


test('普通弹窗说明与ARIA关联统一；未启用说明的共用头保留原输出', () => {
  const render = (description?: React.ReactNode) => <Dialog open><DialogContent>
    <DialogHeader description={description}><DialogTitle>核对资料</DialogTitle></DialogHeader>
    {!description && <DialogDescription className="sr-only">原有隐藏说明</DialogDescription>}
    <div>原有正文</div>
  </DialogContent></Dialog>
  const root = draw(render())
  const dialog = getByRole(document.body, 'dialog')
  expect(dialog.querySelector('.fc-dialog-caption')).toBeNull()
  act(() => root.render(render('保存后按原流程处理。')))
  const caption = dialog.querySelector('.fc-dialog-caption')!
  expect(dialog.querySelectorAll('.fc-dialog-caption')).toHaveLength(1)
  expect(caption.textContent).toBe('保存后按原流程处理。')
  expect(dialog.getAttribute('aria-describedby')).toBe(caption.id)
  expect(dialog.textContent).toContain('原有正文')
  act(() => root.render(render(<><p>批准后按原申请执行。</p><p>凭证结果需要单独核对。</p></>)))
  expect(caption.tagName).toBe('DIV')
  expect(caption.querySelectorAll(':scope > p')).toHaveLength(2)
  expect(caption.querySelector('p p')).toBeNull()
})
