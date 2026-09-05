import type { QueryKey } from '@tanstack/react-query'

const ACCOUNTING_QUERY_ROOTS = new Set([
  'acct-vouchers', 'acct-ledger', 'acct-accounts', 'acct-invoices',
  'accounting-periods', 'fixed-assets', 'tax-vat', 'tax-income',
  'tax-adjustments', 'consol-bs', 'consol-inc',
])
export function isAccountingQuery(key: QueryKey): boolean {
  return ACCOUNTING_QUERY_ROOTS.has(String(key[0]))
}
export function isAccountingRequest(url = ''): boolean {
  return /^\/(?:accounting|fixed-assets|hr)(?:\/|$)/.test(url)
    || /^\/export\/(?:fixed-assets|accounting-periods|tax-adjustments)(?:\?|$)/.test(url)
}
