import * as React from "react"

import { cn } from "@/lib/utils"
import { quantityInputError } from "@/lib/qtyStep"
import { toast } from "@/lib/toast"

type InputProps = React.ComponentProps<"input"> & {
  /** 仅数量字段启用；金额、单价、换算率不要设置。step=1 时同时限制整数。 */
  quantity?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, quantity = false, onChange, onPaste, onBlur, ...props }, ref) => {
    const accepted = React.useRef(String(props.defaultValue ?? ''))
    const rejected = React.useRef(false)
    const integerOnly = String(props.step) === '1'
    const reject = (input: HTMLInputElement, message: string) => {
      input.value = props.value === undefined ? accepted.current : String(props.value ?? '')
      rejected.current = true
      toast.error(message)
    }
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
        step={quantity ? props.step ?? '0.01' : props.step}
        onChange={event => {
          const error = quantity ? quantityInputError(event.currentTarget.value, integerOnly) : null
          if (error) { reject(event.currentTarget, error); return }
          accepted.current = event.currentTarget.value
          rejected.current = false
          onChange?.(event)
        }}
        onPaste={event => {
          const error = quantity ? quantityInputError(event.clipboardData.getData('text'), integerOnly) : null
          if (error) { event.preventDefault(); rejected.current = true; toast.error(error); return }
          onPaste?.(event)
        }}
        onBlur={event => {
          const error = quantity ? quantityInputError(event.currentTarget.value, integerOnly) : null
          if (error) { reject(event.currentTarget, error); return }
          // 采购建议在失焦时直接写 API；拒绝的输入不能触发该写入。
          if (quantity && rejected.current) { rejected.current = false; return }
          onBlur?.(event)
        }}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
