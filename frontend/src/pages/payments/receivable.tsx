import PaymentsView from './PaymentsView'

/** 应收账款（销售）。实现见 PaymentsView，应付是同一份代码的另一个 type。 */
export default function ReceivablePage() {
  return <PaymentsView type={2} />
}
