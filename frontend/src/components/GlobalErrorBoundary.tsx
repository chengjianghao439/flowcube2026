import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * GlobalErrorBoundary — 全局渲染错误捕获
 *
 * 捕获子组件树中的任何 render 错误，显示友好的错误恢复页面。
 * 不处理：异步错误、事件处理器错误（这些由 unhandledrejection 捕获）
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info })
    // 记录到 console（生产环境可接入 Sentry 等）
    console.error('[GlobalErrorBoundary] 捕获到渲染错误:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const isDev = import.meta.env.DEV
    const { error, errorInfo } = this.state

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
        <div className="w-full max-w-lg rounded-2xl border border-destructive/20 bg-card p-8 shadow-lg">
          {/* 图标 */}
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </div>

          {/* 标题 */}
          <h1 className="mb-2 text-center text-xl font-semibold text-foreground">
            页面渲染出错
          </h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            系统遇到了一个意外错误，请刷新页面或联系管理员。
          </p>

          {/* 错误信息（开发环境） */}
          {isDev && error && (
            <div className="mb-6 overflow-auto rounded-lg bg-muted p-4 text-left">
              <p className="mb-1 text-xs font-semibold text-destructive">
                {error.name}: {error.message}
              </p>
              {errorInfo?.componentStack && (
                <pre className="mt-2 whitespace-pre-wrap text-[10px] text-muted-foreground">
                  {errorInfo.componentStack.trim().slice(0, 800)}
                </pre>
              )}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={this.handleReset}>
              尝试恢复
            </Button>
            <Button onClick={this.handleReload}>
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新页面
            </Button>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">极序 Flow · 错误已被记录</p>
      </div>
    )
  }
}
