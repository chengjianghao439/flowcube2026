/**
 * PdaStepHint — 当前步骤操作提示条
 */
import { TriangleAlert, Pointer, Lightbulb, ArrowRight } from 'lucide-react'

interface PdaStepHintProps {
  step:       string
  nextStep?:  string
  errorHint?: string
  hasError?:  boolean
  stepNo?:    string
}

export default function PdaStepHint({
  step,
  nextStep,
  errorHint,
  hasError = false,
  stepNo,
}: PdaStepHintProps) {
  return (
    <div className={`rounded-xl border px-4 py-3 transition-all ${
      hasError ? 'border-red-200 bg-red-50' : 'border-primary/20 bg-primary/5'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`shrink-0 ${
          hasError ? 'text-red-500' : 'text-primary'
        }`}>
          {hasError
            ? <TriangleAlert className="h-5 w-5" />
            : <Pointer className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          {stepNo && (
            <p className="text-[10px] font-mono text-muted-foreground mb-0.5">步骤 {stepNo}</p>
          )}
          <p className={`text-sm font-semibold ${
            hasError ? 'text-red-700' : 'text-foreground'
          }`}>
            {step}
          </p>
        </div>
      </div>

      {(hasError ? errorHint : nextStep) && (
        <div className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 ${
          hasError ? 'bg-red-100' : 'bg-background/60'
        }`}>
          <span className="mt-0.5 shrink-0">
            {hasError
              ? <Lightbulb className="h-4 w-4 text-red-700" />
              : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          </span>
          <p className={`text-xs leading-relaxed ${
            hasError ? 'text-red-700 font-medium' : 'text-muted-foreground'
          }`}>
            {hasError ? errorHint : nextStep}
          </p>
        </div>
      )}
    </div>
  )
}
