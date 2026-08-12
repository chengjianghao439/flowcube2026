/**
 * OperatorSelectField — 查询弹窗里的「经办人 / 申请人」下拉
 *
 * 各查询弹窗的经办人筛选是同一段 20 行代码的 6 份拷贝（user-options 数据 + （我）标注
 * + （已禁用）后缀），抽成共享组件消除重复。
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useUserOptions, userOptionLabel } from '@/hooks/useUserOptions'

interface Props {
  /** 当前选中的用户 id（null=全部） */
  value: number | null
  /** 选中变化回调（null=全部） */
  onChange: (id: number | null) => void
  /** 选中用户的 realName 回调（供 chips 显示，onChange 为 null 时传空串） */
  onChangeName?: (name: string) => void
  /** 是否在弹窗关闭时不请求数据 */
  enabled?: boolean
  /** 占位文案（默认「全部经办人」） */
  placeholder?: string
  className?: string
}

export default function OperatorSelectField({ value, onChange, onChangeName, enabled = true, placeholder = '全部经办人', className }: Props) {
  const { options, currentUserId } = useUserOptions(enabled)
  return (
    <Select
      value={value ? String(value) : '__all__'}
      onValueChange={v => {
        if (v === '__all__') { onChange(null); onChangeName?.(''); return }
        const id = Number(v)
        onChange(id)
        onChangeName?.(options.find(u => u.id === id)?.realName ?? '')
      }}
    >
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(u => (
          <SelectItem key={u.id} value={String(u.id)}>
            {userOptionLabel(u, currentUserId)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
