import PaymentsView from './PaymentsView'

/** 应付账款（采购）。实现见 PaymentsView，应收是同一份代码的另一个 type。 */
export default function PayablePage() {
  return <PaymentsView type={1} />
}
