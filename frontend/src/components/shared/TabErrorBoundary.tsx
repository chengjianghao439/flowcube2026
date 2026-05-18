/**
 * TabErrorBoundary — 单 Tab 级别的错误边界
 *
 * 与全局 GlobalErrorBoundary 不同：
 * - 仅捕获当前 Tab 渲染错误，不影响其他 Tab
 * - 显示内联恢复 UI，无需刷新整个页面
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  tabName?: string
}

interface State {
  hasError: boolean
  errorMsg: string
}

export default class TabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMsg: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, errorMsg: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 记录到 console，不阻塞用户
    console.error('[TabErrorBoundary]', this.props.tabName, error.message, info.componentStack?.slice(0, 200))
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMsg: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-background/50">
          <div className="flex flex-col items-center gap-4 p-8 text-center max-w-sm">
            <AlertTriangle className="h-10 w-10 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">
                {this.props.tabName ? `「${this.props.tabName}」页面出错` : '页面加载出错'}
              </h3>
              <p className="text-xs text-muted-foreground">
                此页面渲染时发生错误，已自动隔离。您可尝试重新加载此页面，其他页面不受影响。
              </p>
            </div>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新加载
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
