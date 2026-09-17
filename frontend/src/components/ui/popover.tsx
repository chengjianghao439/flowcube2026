import { useVisibleDisclosure } from '@/hooks/useVisibleDisclosure'
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const disclosure = useVisibleDisclosure(props)
  return <PopoverPrimitive.Root {...props} {...disclosure} />
}

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({
  className,
  align = "center",
  sideOffset = 4,
  // 默认按视口做碰撞避让，而不是按最近的裁剪祖先：
  // 浮层常挂在带 overflow-y-auto 的弹窗内容里，若按弹窗裁剪框判定，
  // 明明可以溢出弹窗完整显示（fixed 定位不受其裁剪），却会被判成"放不下"而翻到弹窗外。
  collisionBoundary = [],
  collisionPadding = 8,
  // 空间不足时沿主轴把浮层夹在视口内，避免只露出一部分（如日历表头被切掉）。
  sticky = "always",
  ...props
}, ref) => (
  // 不使用 Portal：Portal 会把内容挂到 document.body，此时外层 Dialog（Radix Dialog modal）
  // 的 FocusScope 会把焦点抢回弹窗内，浮层的 FocusScope 立即判定为焦点移出并 onDismiss，
  // 表现为"日历一打开就关"。保持 DOM 上是 Trigger 的真实子孙即可避免这场焦点争夺。
  // Content 是 fixed 定位，只要祖先没有 transform，就以视口为包含块；祖先的
  // overflow 也裁不到它（不在它的包含块链上）。因此弹窗内浮层能否溢出不被裁切，
  // 取决于 ui/dialog.tsx 的 DialogContent 不用 translate 居中——见那里的说明。
  <PopoverPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    collisionBoundary={collisionBoundary}
    collisionPadding={collisionPadding}
    sticky={sticky}
    className={cn(
      "z-50 w-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
