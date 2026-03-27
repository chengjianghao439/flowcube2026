/** 与主进程 semver 语义一致：按 x.y.z 数值比较远程是否更新 */
export function normalizeVersion(v: string): string {
  return String(v).trim().replace(/^v/i, '')
}

export function isRemoteNewer(current: string, remote: string): boolean {
  const a = normalizeVersion(current)
  const b = normalizeVersion(remote)
  if (!b || a === b) return false
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}
