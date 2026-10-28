import { useContext, useMemo, useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Loader2 } from 'lucide-react'
import { getSettingsApi, updateSettingsApi, getLogoApi, uploadLogoApi } from '@/api/settings'
// 与 BrandLogo 组件的查询键保持一致（那里为避免 react-refresh warning 未导出常量）
const BRAND_LOGO_QUERY_KEY = ['brand-logo']
import { toast } from '@/lib/toast'
import { ActionBar } from '@/components/shared/ActionBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermission } from '@/hooks/usePermission'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import { todayYmd } from '@/lib/dateTime'
import { groupSettings } from './settingsSections'

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const LOGO_FRIENDLY = ['PNG', 'JPEG', 'WebP', 'SVG'].join(' / ')

export default function SettingsPage() {
  const { can } = usePermission()
  const canUpdate = can(PERMISSIONS.SETTINGS_UPDATE)
  const qc = useQueryClient()

  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => getSettingsApi() })
  const sections = useMemo(() => groupSettings(data?.list ?? []), [data?.list])
  // 保存成功后回到默认（只读）态：页面状态本身的变化就是「已保存」的反馈
  const save = useMutation({
    mutationFn: updateSettingsApi,
    onSuccess: (_result, submitted) => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      // 保存期间又输入了新内容时留在编辑态，不能把后续草稿当成已保存
      if (JSON.stringify(formRef.current) === JSON.stringify(submitted)) setEditing(false)
      toast.success('保存成功')
    },
  })

  // 品牌 Logo：与 BrandLogo 组件共享同一查询键（多点位只发一次请求）
  const { data: logo } = useQuery({
    queryKey: BRAND_LOGO_QUERY_KEY,
    queryFn: () => getLogoApi({ skipGlobalError: true }),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const [form, setForm] = useState<Record<string, string>>({})
  /** 最新表单值（保存回执判断用）：与提交内容一致才回到默认态 */
  const formRef = useRef(form)
  formRef.current = form
  /** 默认态=只读查看；点「编辑」才可改，保存成功后自动回到默认态 */
  const [editing, setEditing] = useState(false)
  const [logoImgFailed, setLogoImgFailed] = useState(false)

  /** 设置基线：与后端返回一致，用于「是否改过」判断与「取消编辑」回滚 */
  const baseline = useMemo(() => {
    const m: Record<string, string> = {}
    // image/timestamp 键（公司 Logo）不进表单：它们有自己的上传链路与校验，
    // 混进「保存设置」的批量提交会把 Logo 覆盖成空值（后端 updateMany 也拒绝，双保险）
    data?.list?.forEach(s => {
      if (s.type === 'image' || s.type === 'timestamp') return
      m[s.key_name] = s.value ?? ''
    })
    return m
  }, [data])

  useEffect(() => {
    if (data?.list) setForm(baseline)
  }, [data, baseline])

  const handleSave = () => save.mutate(form)
  /** 进入编辑态：以基线为起点，避免上次未保存残留 */
  const startEdit = () => { setForm(baseline); setEditing(true) }
  /** 取消编辑：丢弃改动回到默认（只读）态 */
  const cancelEdit = () => { setForm(baseline); setEditing(false) }

  // 未保存变更保护：编辑态下表单与基线不同即脏（关闭标签拦截）
  const tabPath = useContext(TabPathContext) || ''
  const isDirty = useMemo(() => {
    if (!editing) return false
    return Object.keys(form).length !== Object.keys(baseline).length
      || Object.entries(baseline).some(([k, v]) => form[k] !== v)
  }, [editing, baseline, form])
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
    <div className="desktop-page-sample settings-page-sample space-y-5">
      <ActionBar
        title="系统设置"
        description={!canUpdate ? <>当前账号无修改权限{isDirty && '。有未保存的更改，关闭标签前请先保存。'}</> : isDirty ? '有未保存的更改，关闭标签前请先保存。' : editing ? '正在编辑全局配置，保存后立即生效并回到查看状态。' : '维护企业资料与业务参数。'}
        subtitle={editing ? <><EditModeBadge /><UnsavedBadge show={isDirty} /></> : undefined}
        rightActions={canUpdate ? (
          editing ? (
            <>
              <Button variant="outline" onClick={cancelEdit} disabled={save.isPending}>取消编辑</Button>
              <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中…' : '保存修改'}</Button>
            </>
          ) : (
            <Button variant="outline" onClick={startEdit}>编辑</Button>
          )
        ) : null}
      />



      <div className="sample-settings-grid" data-editing={editing}>
      <section className="sample-settings-card" aria-label="品牌标识">
        <header><h2>品牌标识</h2><span className="sample-settings-count">公司 Logo</span></header>
        <div className="sample-settings-brand flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="sample-logo-preview shrink-0">
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
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                公司 Logo 显示于 ERP 顶栏与打印单据模板（销售单/采购单/出库单/仓库任务单）。支持 {LOGO_FRIENDLY}，≤2MB，上传后立即生效。
              </p>
            </div>
            {editing && canUpdate ? (
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
            ) : canUpdate ? (
              <p className="text-sm text-muted-foreground">点右上角「编辑」后可上传/更换 Logo。</p>
            ) : null}
          </div>
        </div>
      </section>

      {sections.map(section => <section key={section.id} className="sample-settings-card" aria-label={section.title}>
        <header><h2>{section.title}</h2><span className="sample-settings-count">{section.items.length} 项</span></header>
        <div className="sample-settings-fields divide-y divide-border">
          {section.items.map(s => (
            <div key={s.key_name} className="sample-setting-row">
              <div>
                {editing ? (
                  <Label htmlFor={`setting-${s.key_name}`} className="font-medium">{s.label}</Label>
                ) : (
                  <p className="text-sm font-medium text-foreground">{s.label}</p>
                )}
                {s.remark && <p className="mt-0.5 text-xs text-muted-foreground">{s.remark}</p>}
              </div>
              <div className="space-y-1.5">
                {editing ? (
                  <Input
                    id={`setting-${s.key_name}`}
                    value={form[s.key_name] ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [s.key_name]: e.target.value }))}
                    type={s.type === 'number' ? 'number' : 'text'}
                    disabled={!canUpdate}
                    className="max-w-2xl"
                  />
                ) : (
                  <p className="max-w-2xl text-sm font-medium text-foreground">
                    {form[s.key_name]?.trim()
                      ? form[s.key_name]
                      : <span className="font-normal text-muted-foreground">未设置</span>}
                  </p>
                )}
                {s.label.includes('前缀') && !s.label.includes('编号') && (
                  <p className="text-xs text-muted-foreground">
                    生成的单号示例：<span className="font-mono text-foreground/80">{form[s.key_name] || '—'}{todayYmd().replace(/-/g, '')}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>)}
      </div>
    </div>
  )
}
