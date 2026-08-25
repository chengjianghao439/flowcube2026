import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Loader2 } from 'lucide-react'
import { getSettingsApi, updateSettingsApi, getRolesApi, getLogoApi, uploadLogoApi } from '@/api/settings'
// 与 BrandLogo 组件的查询键保持一致（那里为避免 react-refresh warning 未导出常量）
const BRAND_LOGO_QUERY_KEY = ['brand-logo']
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const LOGO_FRIENDLY = ['PNG', 'JPEG', 'WebP', 'SVG'].join(' / ')

export default function SettingsPage() {
  const { can } = usePermission()
  const canUpdate = can(PERMISSIONS.SETTINGS_UPDATE)
  const qc = useQueryClient()

  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => getSettingsApi() })
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => getRolesApi().then(r => r || []) })
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
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="系统设置"
        description="配置全局参数与角色权限。"
      />

      {/* 品牌标识 */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="font-semibold text-base border-b pb-3">品牌标识</h2>
        <div className="flex items-start gap-6">
          {/* 预览：有 Logo 显示图片（后端时间戳参数破缓存），无 Logo 显示默认图标 */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30">
            {logo?.url && !logoImgFailed ? (
              <img
                src={logo.url}
                alt="公司 Logo 预览"
                className="h-full w-full object-contain p-1.5"
                onError={() => setLogoImgFailed(true)}
              />
            ) : (
              <span className="text-xs text-muted-foreground">未设置</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-sm font-medium">公司 Logo</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                显示于 ERP 顶栏、登录页与 PDA 登录页/首页；支持 {LOGO_FRIENDLY}，≤2MB，上传后立即全端生效。
              </p>
            </div>
            {canUpdate ? (
              <div className="flex items-center gap-2">
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
      </div>

      {/* 基础参数 */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="font-semibold text-base border-b pb-3">基础参数</h2>
        {data?.list.filter(s => s.type !== 'image' && s.type !== 'timestamp').map(s => (
          <div key={s.key_name} className="grid grid-cols-3 gap-4 items-start">
            <div>
              <Label className="font-medium">{s.label}</Label>
              {s.remark && <p className="text-xs text-muted-foreground mt-0.5">{s.remark}</p>}
            </div>
            <div className="col-span-2">
              <Input
                value={form[s.key_name] ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [s.key_name]: e.target.value }))}
                type={s.type === 'number' ? 'number' : 'text'}
                disabled={!canUpdate}
              />
            </div>
          </div>
        ))}
        {canUpdate && (
          <div className="pt-2">
            <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中…' : '保存设置'}</Button>
          </div>
        )}
        {!canUpdate && <p className="text-sm text-muted-foreground">当前账号无修改权限</p>}
      </div>

      {/* 角色说明 */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="font-semibold text-base border-b pb-3 mb-4">角色权限说明</h2>
        <div className="space-y-3">
          {roles?.map(r => (
            <div key={r.id} className="flex items-start gap-4">
              <SoftStatusLabel label={r.name} tone={r.id === 1 ? 'active' : 'info'} className="shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">{r.remark || '-'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
