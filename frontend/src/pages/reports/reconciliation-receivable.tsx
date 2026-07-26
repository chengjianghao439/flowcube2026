import ReconciliationView from './ReconciliationView'

/** 客户对账（应收）。实现见 ReconciliationView，供应商对账是同一份代码的另一个 type。 */
export default function ReconciliationReceivablePage() {
  return <ReconciliationView type={2} />
}
