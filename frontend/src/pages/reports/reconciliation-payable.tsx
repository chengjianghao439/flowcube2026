import ReconciliationView from './ReconciliationView'

/** 供应商对账（应付）。实现见 ReconciliationView，客户对账是同一份代码的另一个 type。 */
export default function ReconciliationPayablePage() {
  return <ReconciliationView type={1} />
}
