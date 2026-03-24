import client from '@/api/client'
import type { ApiResponse } from '@/types'

export async function getNextCarrierCode(): Promise<string> {
  try {
    const res = await client.get<ApiResponse<{ code: string }>>('/carriers/next-code')
    return res.data.data?.code || 'CAR-0001'
  } catch {
    return 'CAR-0001'
  }
}
