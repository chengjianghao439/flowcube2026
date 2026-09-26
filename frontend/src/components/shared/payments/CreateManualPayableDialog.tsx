import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createPaymentApi, getDebitAccountOptionsApi } from '@/api/payments'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { isUncertainError, receiptDecision } from './useIdempotentSubmit'
import { createRequestKey } from '@/lib/requestKey'
import { todayYmd, shiftYmd, beijingYmd } from '@/lib/dateTime'
import { toast } from '@/lib/toast'
import { usePaymentViewInvalidation } from './usePaymentViewInvalidation'

const FORM_ID = 'manual-payable-create-form'
/** 与后端 payments.service.createManual 的 beginCreationOperationRequest action 一致（回执查询用） */
const CREATE_ACTION = 'payment.record.create'


/** 与后端 constants/settlementType.js 对齐：1现结 2月结 */
const SETTLE_CASH = 1
const SETTLE_MONTHLY = 2
/** 月结默认账期，与后端 normalizeTermsDays 的月结默认值一致 */
const MONTHLY_TERMS_DAYS = 30
/**
 * 金额输入精度：金额与单价按四位小数存储（数量两位，见 lib/qtyStep.ts）。
 * step/min 都给四位，否则浏览器原生校验会把「单价 8.3333」这类合法金额判为非法。
 */
const AMOUNT_STEP = '0.0001'

/**
 * 现结当天到期；月结按默认账期 30 天。与后端 buildDueDateSql 的推算口径一致。
 * 日期一律经 lib/dateTime.ts 的北京原语（业务日期唯一时区），不要自己拼 getFullYear——
 * 见 tests/frontend-date-source-contract.test.js 的守卫。
 */
function defaultDueDate(settlementType: number) {
  const today = todayYmd()
  return settlementType === SETTLE_CASH ? today : shiftYmd(today, MONTHLY_TERMS_DAYS)
}

/** 无单据应付的单号：手工录入没有来源单据，给一个人可读、可检索的默认值，允许改 */
function defaultOrderNo() {
  return `AP-${beijingYmd().replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

// 「未确认」与「确定失败」必须分开（判定见 useIdempotentSubmit 的 isUncertainError）：
// 建账款没有业务唯一约束兜底（手工账款 order_id 恒 NULL，UNIQUE(type, order_id) 对多个 NULL 不生效），
// 防重复**完全**依赖请求键。传输层失败时服务器可能已经建好了，换键再录一次就会落两条同金额应付。

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 新建手工应付（无单据应付）：运费、零星费用这类没有采购单可挂的负债。
 *
 * 三个关键口径（2026-09-26 一致性审查 · 任务 3b）：
 *   · **必选借方科目**——缺了它这笔负债入不了账，只会挂在勾稽的「未分类」里等财务确认。
 *     系统对自动产生的应付自己带入科目（运费 6601），人工录入的必须由财务逐笔判断，不猜。
 *   · **必选结算方式**——它决定这笔账款归「现结供应商账款」页还是「月结供应商对账」页
 *     （两页各按 settlement_type 筛），选错就等于从录入人的列表里消失。
 *   · **稳定请求键**——建账款是改钱路径且不受单号唯一约束（手工账款 order_id 恒 NULL），
 *     键在弹窗打开时生成一次、成功后换新，连点两次/断网重试不会落两条。
 */
export function CreateManualPayableDialog({ open, onClose }: Props) {
  const invalidatePaymentViews = usePaymentViewInvalidation()
  const [orderNo, setOrderNo] = useState(defaultOrderNo)
  const [partyName, setPartyName] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [settlementType, setSettlementType] = useState<number>(SETTLE_CASH)
  const [dueDate, setDueDate] = useState(() => defaultDueDate(SETTLE_CASH))
  // 到期日被手工改过之后，切换结算方式不再覆盖它（否则用户的输入被静默丢弃）
  const [dueTouched, setDueTouched] = useState(false)
  const [debitAccountCode, setDebitAccountCode] = useState('')
  const [remark, setRemark] = useState('')
  const [requestKey, setRequestKey] = useState(() => createRequestKey('payable'))
  const [error, setError] = useState('')
  // 上次提交结果未确认（传输层失败）。state 管渲染，ref 供 reset 判定——
  // reset 在 open 变化的 effect 里调用，读 state 会引入依赖，这里只需要当前值。
  const [uncertain, setUncertain] = useState(false)
  const uncertainRef = useRef(false)
  const markUncertain = (v: boolean) => { uncertainRef.current = v; setUncertain(v) }

  // 借方科目下拉：只在弹窗打开时拉取；科目停用/汇总都由后端拒绝，这里只提供合法候选
  const { data: options } = useQuery({
    queryKey: ['debit-account-options'],
    queryFn: () => getDebitAccountOptionsApi().then(r => r || []),
    enabled: open,
  })

  function reset() {
    // 上次提交结果未确认时**不重置**：换新请求键等于把「可能已经建好的那一笔」当成新账再录一次，
    // 而手工账款没有业务唯一约束兜底。表单与单号一并保留，用户可原样重试（同键被后端认作同一笔）。
    if (uncertainRef.current) return
    setOrderNo(defaultOrderNo()); setPartyName(''); setTotalAmount('')
    setSettlementType(SETTLE_CASH); setDueDate(defaultDueDate(SETTLE_CASH)); setDueTouched(false)
    setDebitAccountCode(''); setRemark(''); setError('')
    setRequestKey(createRequestKey('payable'))
  }

  // 依赖刻意只认 open：每次打开都是一张干净表单，但填写途中（如 open 未变的重渲染）不重置
  useEffect(() => { if (open) reset() }, [open])

  const selectedAccount = (options || []).find(a => a.code === debitAccountCode)

  const mut = useMutation({
    mutationFn: () => createPaymentApi({
      type: 1,
      orderNo: orderNo.trim(),
      partyName: partyName.trim(),
      totalAmount: Number(totalAmount),
      settlementType: settlementType === SETTLE_MONTHLY ? SETTLE_MONTHLY : SETTLE_CASH,
      dueDate: dueDate || undefined,
      debitAccountCode,
      remark: remark || undefined,
    }, requestKey),
    onSuccess: () => {
      markUncertain(false)
      // 列表由失效缓存自动刷新（现结进「现结供应商账款」页、月结进「月结供应商对账」页）
      invalidatePaymentViews()
      toast.success(`应付账款 ${orderNo.trim()} 已创建，会计生成凭证后即计入账上`)
      onClose()
    },
    // 校验错误（科目非法、单号为空等）留在弹窗里显示，而不是一闪而过的 toast——
    // 这条录入的成败取决于财务能否看到具体哪一项不合格
    onError: (e: unknown) => {
      if (isUncertainError(e)) {
        // 没收到服务器答复：保留请求键与内容，先查回执再决定，别让用户以为「失败了要重录」
        markUncertain(true)
        setError('提交结果未确认：网络中断或超时，服务器可能已经创建了这笔应付。请先点「查询上次结果」，确认没有再重试。')
        return
      }
      markUncertain(false)
      setError(e instanceof Error ? e.message : '创建失败，请重试')
    },
  })

  /**
   * 查上次提交的回执（后端 operation_requests 按 requestKey + action 留痕）。
   * 这是「结果未确认」时唯一能确定成没成的办法——不看就重录，可能重复入账。
   */
  const checkMut = useMutation({
    mutationFn: () => getOperationRequestStatusApi(requestKey, CREATE_ACTION),
    onSuccess: (r) => {
      if (r.status === 'success') {
        markUncertain(false)
        invalidatePaymentViews()
        toast.success(`上次提交的应付账款已创建成功（单号 ${orderNo.trim()}），无需重复录入`)
        onClose()
        return
      }
      if (r.status === 'pending') {
        setError('上次提交仍在服务器处理中，请稍后再点「查询上次结果」。')
        return
      }
      const decision = receiptDecision(r.status)
      if (!decision.rotateKey) {
        // not_found 不等于「没做成」：幂等记录的 PENDING 行写在业务事务里
        // （backend/src/utils/operationRequest.js），事务提交前另一个连接读不到。
        // 保持「未确认」与原请求键，两种情况都安全（判定依据见 receiptDecision）。
        markUncertain(true)
        setError('当前还查不到这次提交：可能仍在处理中（服务端事务未提交时查不到回执记录），也可能没有送达。请勿改动内容重录——用同一份内容再点一次「创建」即可，同一个请求键会被认作同一笔，不会重复入账；想改内容请先点「查询上次结果」确认。')
        return
      }
      // failed：服务端明确写下了失败行，这时才换键重试
      markUncertain(false)
      setRequestKey(createRequestKey('payable'))
      setError('已确认上次提交失败，可以放心重试。')
    },
    onError: () => setError('查询上次结果失败，请稍后再试。在确认之前请不要关掉重开重新录入，以免重复入账。'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!orderNo.trim()) { setError('请填写单号'); return }
    if (!partyName.trim()) { setError('请填写供应商名称'); return }
    if (!(Number(totalAmount) > 0)) { setError('金额必须大于 0'); return }
    if (!debitAccountCode) { setError('请选择借方科目：缺了它这笔应付无法入账'); return }
    mut.mutate()
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="manual-payable-create"
      title="新建应付账款（无单据）"
      defaultWidth={720}
      defaultHeight={620}
      minWidth={560}
      minHeight={480}
      footer={
        <div className="flex justify-end gap-2">
          {/* 上次提交没收到服务器答复时，唯一能确定「到底建没建成」的办法就是按请求键查回执；
              查清楚之前不要关掉重开重录，那可能把同一笔应付录两遍（手工账款没有唯一约束兜底）。 */}
          {uncertain && (
            <Button type="button" variant="outline" onClick={() => checkMut.mutate()} disabled={checkMut.isPending}>
              {checkMut.isPending ? '查询中…' : '查询上次结果'}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" form={FORM_ID} disabled={mut.isPending}>
            {mut.isPending ? '创建中…' : '创建'}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="h-full overflow-y-auto p-5">
        <p className="mb-4 text-sm text-muted-foreground">
          没有采购单/运费单可挂的应付（零星费用、押金、线下结算的采购）在这里录入。
          创建后不会自动记账：需在「凭证」页点「生成本期凭证」入账。
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>单号 *</Label>
            <Input value={orderNo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrderNo(e.target.value)} placeholder="如 AP-20260926-0001" />
          </div>
          <div className="space-y-1">
            <Label>供应商 *</Label>
            <Input value={partyName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPartyName(e.target.value)} placeholder="输入供应商名称" />
          </div>
          <div className="space-y-1">
            <Label>金额 *</Label>
            <Input type="number" min={AMOUNT_STEP} step={AMOUNT_STEP} value={totalAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotalAmount(e.target.value)} placeholder="本次应付金额" />
          </div>
          <div className="space-y-1">
            <Label>结算方式 *</Label>
            <Select
              value={String(settlementType)}
              onValueChange={v => {
                const next = Number(v)
                setSettlementType(next)
                // 未手工改过到期日就跟着结算方式走，避免「现结却显示 30 天后到期」的矛盾组合
                if (!dueTouched) setDueDate(defaultDueDate(next))
              }}
            >
              <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={String(SETTLE_CASH)}>现结（进「现结供应商账款」页）</SelectItem>
                <SelectItem value={String(SETTLE_MONTHLY)}>月结（进「月结供应商对账」页）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>到期日</Label>
            <DatePicker value={dueDate} onChange={v => { setDueDate(v); setDueTouched(true) }} />
          </div>
          <div className="space-y-1">
            <Label>借方科目 *</Label>
            <Select value={debitAccountCode} onValueChange={setDebitAccountCode}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="选择这笔应付计入的费用/资产科目" />
              </SelectTrigger>
              <SelectContent>
                {(options || []).map(a => (
                  <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* 下拉里只显示 code+name，选中后把这笔将生成的分录写清楚，财务能一眼核对 */}
            {selectedAccount && (
              <p className="text-xs text-muted-foreground">
                将生成分录：借 {selectedAccount.code} {selectedAccount.name} / 贷 2202 应付账款
              </p>
            )}
          </div>
          <div className="space-y-1 col-span-2">
            <Label>备注</Label>
            <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填：为什么没有单据、对应哪笔业务" />
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </form>
    </AppDialog>
  )
}
