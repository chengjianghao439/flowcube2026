import client from './client'
import type { ApiResponse } from '@/types'
export interface PaymentRecord { id:number; type:1|2; typeName:string; orderNo:string; partyName:string; totalAmount:number; paidAmount:number; balance:number; status:1|2|3; statusName:string; dueDate?:string; remark?:string; createdAt:string }
export interface PaymentEntry { id:number; amount:number; paymentDate:string; method?:string; remark?:string; operatorName:string; createdAt:string }
export interface PaymentSummary { totalAmount:number; paidAmount:number; balance:number }
export const getPaymentsApi  = (p:object) => client.get<ApiResponse<{list:PaymentRecord[];pagination:unknown;summary:PaymentSummary}>>('/payments', {params:p})
export const createPaymentApi= (d:object) => client.post<ApiResponse<{id:number}>>('/payments', d)
export const payApi          = (id:number, d:object) => client.post<ApiResponse<unknown>>(`/payments/${id}/pay`, d)
export const getEntriesApi   = (id:number) => client.get<ApiResponse<PaymentEntry[]>>(`/payments/${id}/entries`)
