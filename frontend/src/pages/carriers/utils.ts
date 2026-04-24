import { payloadClient as client } from '@/api/client'

export async function getNextCarrierCode(): Promise<string> {
  try {
    const res = await client.get<{ code: string }>('/carriers/next-code')
    return res?.code || 'CAR-0001'
  } catch {
    return 'CAR-0001'
  }
}
