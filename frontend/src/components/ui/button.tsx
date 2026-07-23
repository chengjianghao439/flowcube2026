import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // 扁平化 + transition-all + active:scale：对标 Linear/飞书后台的克制质感，不靠投影堆叠层次
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // 主操作：纯色块，不额外加投影，靠颜色本身建立层级
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95",
        // 危险操作：同样扁平，hover 加深即可
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/95",
        // 次操作：保留细边框给出清晰边界，但不叠加投影；底色极淡，hover/active 逐级加深
        outline:
          "border-border bg-muted/40 text-foreground hover:bg-muted hover:border-border active:bg-muted/80",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link:
          "text-primary underline-offset-4 hover:underline",
        // subtle: primary 的低调版本，适合列表行内次要主操作
        // 用法：<Button variant="subtle">查看详情</Button>
        subtle:
          "bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/20",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        // PDA 工业终端高频操作按钮：48×48dp 最小点击区域，touch-action 消除双击缩放延迟，适合工业手套操作
        pda: "h-12 min-w-12 rounded-md px-8 [touch-action:manipulation]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
