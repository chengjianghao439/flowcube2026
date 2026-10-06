import type { Product } from './products'
import type { KitDefinition } from './kits'
import type { Customer } from './customers'
import type { CustomerResolvedPrice } from '@/api/price-lists'
export type ReorderIdentity = { kind: 'ordinary'; productId: number; baseUnit: string; baseQty: number } | { kind: 'kit'; kitId: number; originalKitVersionId: number; quantity: number }
export interface SaleReorderSource { id: number; orderNo: string; model: 'ordinary' | 'kit-v1'; customerId: number; items: ReorderIdentity[] }
export type CurrentReorderItem = { identity: ReorderIdentity; product?: Product; kit?: KitDefinition; quote?: CustomerResolvedPrice; error?: string }
export interface CurrentReorderSource { source: SaleReorderSource; customer?: Customer; customerError?: string; items: CurrentReorderItem[] }
