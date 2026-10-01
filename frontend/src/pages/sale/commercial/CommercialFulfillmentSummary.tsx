import type { KitReadOwner } from '@/api/kits'
import type { CommercialGroup } from '@/types/sale-commercial'
import { OrderFulfillmentPanel } from '@/components/shared/OrderFulfillmentPanel'
/** Preserve original fulfillment issue/date actions with the commercial page's fixed read/write source. */
export default function CommercialFulfillmentSummary({
  id,
  owner,
  groups
}: {
  id: number
  owner: KitReadOwner
  groups: CommercialGroup[]
}) {
  return <OrderFulfillmentPanel type="sale" id={id} readOwner={owner} commercialGroups={groups} />
}
