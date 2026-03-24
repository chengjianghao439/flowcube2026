/**
 * PdaErrorBoundary — PDA 页面崩溃自动恢复
 *
 * 功能：
 *  - 捕获子树渲染错误，显示友好恢复页面
 *  - 提供「重试」（原地重新渲染）和「返回工作台」两个恢复选项
 *  - 将错误信息存入 sessionStorage，便于调试
 */
import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  errorMsg: string
  errorKey: number   // 递增以强制重新挂载子树
}

export default class PdaErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMsg: '', errorKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, errorMsg: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 存到 sessionStorage 便于排查
    try {
      sessionStorage.setItem('pda_last_error', JSON.stringify({
        message: error.message,
        stack:   error.stack?.slice(0, 500),
        component: info.componentStack?.slice(0, 300),
        time: new Date().toISOString(),
      }))
    } catch { /* ignore */ }
  }

  handleRetry = () => {
    this.setState(s => ({ hasError: false, errorMsg: '', errorKey: s.errorKey + 1 }))
  }

  handleHome = () => {
    this.setState(s => ({ hasError: false, errorMsg: '', errorKey: s.errorKey + 1 }))
    window.location.hash = '#/pda'
    window.location.href = '/pda'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
          <p className="text-5xl mb-4">⚠️</p>
          <h2 className="text-xl font-bold text-foreground mb-2">页面出现错误</h2>
          <p className="text-sm text-muted-foreground mb-1">当前操作未完成，请选择恢复方式</p>
          {this.state.errorMsg && (
            <p className="font-mono text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-6 max-w-xs break-all">
              {this.state.errorMsg}
            </p>
          )}
          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={this.handleRetry}
              className="flex-1 rounded-2xl border border-border bg-card py-3 text-sm font-semibold text-foreground active:scale-95"
            >
              ↺ 重试
            </button>
            <button
              onClick={this.handleHome}
              className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground active:scale-95"
            >
              返回工作台
            </button>
          </div>
        </div>
      )
    }

    return (
      <div key={this.state.errorKey}>
        {this.props.children}
      </div>
    )
  }
}
