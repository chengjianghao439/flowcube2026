import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

// Draft ownership follows the actor/session and server, while access tokens may renew within that session.
const identity = () => {
  const auth = useAuthStore.getState()
  return JSON.stringify([getApiClientBaseURL(), !!auth.token, auth.sessionGeneration, auth.user?.id, auth.user?.roleId, auth.user?.permissions])
}
let previous = identity(), epoch = 0
const listeners = new Set<() => void>()
function changed() {
  const next = identity()
  if (next === previous) return
  previous = next
  epoch++
  listeners.forEach(listener => listener())
}
subscribeApiClientBaseURL(changed)
useAuthStore.subscribe(changed)
export const saleEntryEpoch = () => epoch
export function subscribeSaleEntry(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
