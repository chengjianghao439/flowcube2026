import { useContext, useMemo, useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Loader2 } from 'lucide-react'
import { getSettingsApi, updateSettingsApi, getLogoApi, uploadLogoApi } from '@/api/settings'
// 与 BrandLogo 组件的查询键保持一致（那里为避免 react-refresh warning 未导出常量）
const BRAND_LOGO_QUERY_KEY = ['brand-logo']
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import { todayYmd } from '@/lib/dateTime'

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const LOGO_FRIENDLY = ['PNG', 'JPEG', 'WebP', 'SVG'].join(' / ')

export default function SettingsPage() {
  const { can } = usePermission()
  const canUpdate = can(PERMISSIONS.SETTINGS_UPDATE)
  const qc = useQueryClient()

  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => getSettingsApi() })
  const save = useMutation({ mutationFn: updateSettingsApi, onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('保存成功') } })

  // 品牌 Logo：与 BrandLogo 组件共享同一查询键（多点位只发一次请求）
  const { data: logo } = useQuery({
    queryKey: BRAND_LOGO_QUERY_KEY,
    queryFn: () => getLogoApi({ skipGlobalError: true }),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const [form, setForm] = useState<Record<string, string>>({})
  const [logoImgFailed, setLogoImgFailed] = useState(false)
  useEffect(() => {
    if (data?.list) {
      const m: Record<string, string> = {}
      // image/timestamp 键（公司 Logo）不进表单：它们有自己的上传链路与校验，
      // 混进「保存设置」的批量提交会把 Logo 覆盖成空值（后端 updateMany 也拒绝，双保险）
      data.list.forEach(s => {
        if (s.type === 'image' || s.type === 'timestamp') return
        m[s.key_name] = s.value ?? ''
      })
      setForm(m)
    }
  }, [data])

  const handleSave = () => save.mutate(form)

  // 未保存变更保护：表单与设置基线不同即脏（关闭标签拦截）
  const tabPath = useContext(TabPathContext) || ''
  const isDirty = useMemo(() => {
    if (!data?.list) return false
    const base: Record<string, string> = {}
    data.list.forEach(s => { if (s.type === 'image' || s.type === 'timestamp') return; base[s.key_name] = s.value ?? '' })
    return Object.keys(form).length !== Object.keys(base).length
      || Object.entries(base).some(([k, v]) => form[k] !== v)
  }, [data, form])
  useDirtyGuard(tabPath, isDirty)

  // ── Logo 上传 ──────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: (file: File) => uploadLogoApi(file),
    onSuccess: () => {
      // 刷新 Logo（所有品牌位立即更新）与设置列表（含 logo 时间戳键）
      qc.invalidateQueries({ queryKey: BRAND_LOGO_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Logo 已更新，品牌位已同步生效')
    },
  })

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file) return
    if (!LOGO_ACCEPT.includes(file.type)) {
      toast.error(`仅支持 ${LOGO_FRIENDLY} 格式`)
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('Logo 文件不能超过 2MB')
      return
    }
    upload.mutate(file)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="系统设置"
        description="配置全局参数与角色权限。"
        actions={canUpdate ? <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中…' : '保存设置'}</Button> : null}
      />

      {isDirty && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-sm text-warning">
          <span className="h-2 w-2 rounded-full bg-warning" />
          有未保存的更改，关闭标签前请先保存。
        </div>
      )}

      {/* 品牌标识 */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/30">
            {logo?.url && !logoImgFailed ? (
              <img
                src={logo.url}
                alt="公司 Logo 预览"
                className="h-full w-full object-contain p-2"
                onError={() => setLogoImgFailed(true)}
              />
            ) : (
              <span className="px-2 text-center text-xs text-muted-foreground">未设置</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div>
              <h2 className="text-base font-semibold">品牌标识</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                公司 Logo 显示于 ERP 顶栏与打印单据模板（销售单/采购单/出库单/仓库任务单）。支持 {LOGO_FRIENDLY}，≤2MB，上传后立即生效。
              </p>
            </div>
            {canUpdate ? (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoFile}
                />
                <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending} size="sm">
                  {upload.isPending ? (<><Loader2 className="size-4 animate-spin" />上传中…</>) : (<><Upload className="size-4" />{logo?.url ? '更换 Logo' : '上传 Logo'}</>)}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">当前账号无修改权限</p>
            )}
          </div>
        </div>
      </section>

      {/* 基础参数 */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border/60 px-6 py-4">
          <h2 className="text-base font-semibold">基础参数</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">影响业务流程的全局配置，保存后立即生效。</p>
        </div>
        <div className="space-y-4 p-6">
          {data?.list.filter(s => s.type !== 'image' && s.type !== 'timestamp').map(s => (
            <div key={s.key_name} className="grid gap-1.5 sm:grid-cols-[220px_1fr] sm:gap-6">
              <div>
                <Label className="font-medium">{s.label}</Label>
                {s.remark && <p className="mt-0.5 text-xs text-muted-foreground">{s.remark}</p>}
              </div>
              <div className="space-y-1.5">
                <Input
                  value={form[s.key_name] ?? ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [s.key_name]: e.target.value }))}
                  type={s.type === 'number' ? 'number' : 'text'}
                  disabled={!canUpdate}
                  className="max-w-2xl"
                />
                {s.label.includes('前缀') && !s.label.includes('编号') && (
                  <p className="text-xs text-muted-foreground">
                    生成的单号示例：<span className="font-mono text-foreground/80">{form[s.key_name] || '—'}{todayYmd().replace(/-/g, '')}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        {!canUpdate && (
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground">当前账号无修改权限</p>
          </div>
        )}
      </section>
    </div>
  )
}
