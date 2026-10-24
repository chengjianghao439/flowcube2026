import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { isElectronRuntime } from '@/lib/platform'

export default function WarehouseShippingPage() {
  const { can } = usePermission()
  if (!can(PERMISSIONS.WAREHOUSE_TASK_SHIP)) {
    return <p className="py-12 text-center text-muted-foreground">无访问权限</p>
  }
  return <div className="space-y-4">
    <PageHeader title="仓库发货"
        description="使用已绑定仓库的 PDA 扫描物流条码，核对任务后确认出库。"  />

    <section className="max-w-2xl space-y-4 rounded-lg border border-border bg-card p-5" aria-label="发货操作说明">
      <h2 className="text-base font-semibold">在 PDA 工作台选择「出库确认」</h2>
      <p className="text-sm leading-6 text-muted-foreground">请先登录并绑定设备。实际发货使用设备绑定的仓库；未完成绑定时，按页面提示联系管理员获取绑定码。</p>
      {!isElectronRuntime() && <Button asChild>
        <a href="#/pda/ship" target="_blank" rel="noopener noreferrer">打开 PDA 出库确认</a>
      </Button>}
    </section>
  </div>
}
