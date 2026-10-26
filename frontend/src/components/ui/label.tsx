import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "fc-field-label text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

// 只拆分字段末尾（或后接括号提示）的必填星号，保留通配符、乘法与已有标记。
function requiredMarkers(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, child => {
    if (typeof child === "string") {
      return child.split(/(\*(?=\s*(?:[（(]|$)))/u).map((part, index) =>
        part === "*" ? <span key={index} className="text-destructive-ink">*</span> : part
      )
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment) {
      return React.cloneElement(child, undefined, requiredMarkers(child.props.children))
    }
    return child
  })
}

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  >
    {requiredMarkers(children)}
  </LabelPrimitive.Root>
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
