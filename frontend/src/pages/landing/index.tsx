/**
 * 极序 Flow 官网宣传页（Landing Page）
 *
 * 仅当浏览器以「纯域名根路径」访问时渲染（hash 为空串）。
 * 桌面端（file://...#/）、带 #/ 路径访问、已登录用户均不受影响——由
 * router/index.tsx 的 LandingGate 按 window.location.hash 判空分流。
 *
 * 下载信息动态读取：
 *   - 桌面端版本/安装包 URL：/latest.json（nginx 静态服务，免登录）
 *   - PDA 版本/APK URL：/api/pda/version（后端免登录接口）
 */

import { useEffect, useRef, useState } from 'react'
import {
  Layers, ArrowRight, Download, Smartphone, Boxes, ScanLine, ShieldCheck, Radio, Server,
  Mail, Phone, ArrowUpRight,
} from 'lucide-react'

// ── 品牌常量 ───────────────────────────────────────────────────────────
const BRAND = {
  name: '极序 Flow',
  tagline: '企业管理系统',
  claim: '从下单到出库，让每一步仓库作业都有系统在调度。',
  subclaim: '采购 · 销售 · 库存 · 仓储 · 财务一体化 ERP/WMS，电脑端与 PDA 现场协同，扫码即办。',
}

// ── 联系方式 ───────────────────────────────────────────────────────────
const CONTACT = {
  name: '成江皓',
  phone: '15701178441',
  email: '15701178441@139.com',
}

// ── 能力矩阵（与 routeRegistry.ts 真实模块分组呼应，点击跳对应系统页）──
// 配色收敛为单一蓝色系（避免多色相显得「跳」）：同相不同明度区分模块
const MODULES = [
  {
    icon: Boxes,
    title: '采购管理',
    desc: '请购、计划、下单、收货、上架到供应商结算，全链路留痕。',
    color: 'bg-blue-50 text-blue-700',
    href: '#/purchase',
  },
  {
    icon: Radio,
    title: '销售与出库',
    desc: '订单占库、波次拣货、分拣复核、打包出库，多仓并发不串单。',
    color: 'bg-blue-50 text-blue-700',
    href: '#/sale',
  },
  {
    icon: ScanLine,
    title: '仓储现场',
    desc: '容器管理、扫码上架、调拨、盘点、呆滞告警，账面与实际一致。',
    color: 'bg-blue-50 text-blue-700',
    href: '#/picking-waves',
  },
  {
    icon: Server,
    title: '库存与预占',
    desc: '库存唯一事实源 + 预占账，可用量由引擎裁决，绝不出现负库存。',
    color: 'bg-blue-50 text-blue-700',
    href: '#/inventory',
  },
  {
    icon: ShieldCheck,
    title: '财务与账款',
    desc: '应收应付自动生成，收款核销、对账单、费用报销，账目可追溯。',
    color: 'bg-blue-50 text-blue-700',
    href: '#/payments/payable',
  },
  {
    icon: Boxes,
    title: '报表与分析',
    desc: '库存、波次效率、盈亏、利润分析一键导出，经营决策有据可依。',
    color: 'bg-blue-50 text-blue-700',
    href: '#/reports/warehouse-ops',
  },
]

// ── 价值主张 ───────────────────────────────────────────────────────────
const VALUES = [
  {
    title: '扫码驱动，仓库只执行不决策',
    desc: 'PDA 扫一下，系统告诉你下一步做什么、放哪里、拣什么。现场不靠记忆，作业靠流程。',
    href: '#/pda/picking',
  },
  {
    title: '一份数据，三端实时一致',
    desc: '桌面办公、浏览器访问、PDA 现场共用同一后端与同一份事实。账面不漂移，对账不扯皮。',
    href: '#/dashboard',
  },
  {
    title: '打印与作业解耦，坏了不阻塞',
    desc: '标签打印异步入队，桌面客户端领取打印。打印失败不影响业务，现场作业不停摆。',
    href: '#/settings/print-templates',
  },
]

interface LatestJson {
  version?: string
  url?: string
}
interface PdaVersionData {
  version?: string
  releaseNote?: string
}

// ── Hero 工作台示意：网格 = 库位，亮点 = 在途任务 ─────────────────────
function WorkbenchMockup() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl shadow-blue-950/40 backdrop-blur-sm">
      {/* 窗口头 */}
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-amber-400/70" />
        <span className="size-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-3 text-[11px] tracking-wide text-blue-200/60">极序 Flow · 仓储工作台</span>
      </div>

      {/* 内容：库位网格 + 移动亮点 */}
      <div className="relative p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between text-[11px] text-blue-200/50">
          <span>库区 A · 主通道</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-[#6EA8FF]" />
            12 个在途任务
          </span>
        </div>

        {/* 网格（9×4 库位）+ 亮点 */}
        <div className="relative grid grid-cols-9 gap-1.5">
          {Array.from({ length: 36 }).map((_, i) => (
            <div
              key={i}
              className={`aspect-[4/3] rounded-[3px] border ${
                // 少量「占用」格子，其余空位
                i === 5 || i === 11 || i === 14 || i === 23 || i === 29
                  ? 'border-blue-400/30 bg-blue-400/10'
                  : 'border-white/10 bg-white/5'
              }`}
            />
          ))}
          {/* 移动亮点：一颗沿网格漂移的「在途容器」（品牌亮蓝） */}
          <div className="workbench-dot absolute -top-1 left-[8%] size-2 rounded-full bg-[#6EA8FF] shadow-[0_0_12px_rgba(110,168,255,0.9)]" />
        </div>

        {/* 底部一行统计 */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ['今日收件', '328'],
            ['待上架', '41'],
            ['准时出库', '99.2%'],
          ].map(([label, val]) => (
            <div key={label} className="rounded-lg bg-white/5 px-2 py-2">
              <div className="text-base font-semibold text-white">{val}</div>
              <div className="text-[10px] text-blue-200/50">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 滚动淡入（IntersectionObserver 一次性触发）────────────────────────
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      el.classList.add('is-revealed')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            io.disconnect()
          }
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  )
}

// ── 主组件 ─────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [desktop, setDesktop] = useState<LatestJson | null>(null)
  const [pda, setPda] = useState<PdaVersionData | null>(null)

  // 页内锚点滚动：显式 window.scrollTo，而非 <a href="#section">。
  // 后者会改写 window.location.hash，被 LandingGate 误判为「离开宣传页」跳登录。
  // 先按目标元素位置 scrollTo，再 scrollIntoView 兜底（个别环境 scrollTo 不生效时仍能滚）。
  const scrollToSection = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const top = el.getBoundingClientRect().top + window.scrollY - 72 // 72 = sticky 导航高度
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    try {
      window.scrollTo({ top: Math.max(0, top), behavior })
    } catch {
      window.scrollTo(0, Math.max(0, top))
    }
    // 兜底：若 scrollTo 未改变滚动位置，退回 scrollIntoView
    const before = window.scrollY
    setTimeout(() => {
      if (Math.abs((window.scrollY || 0) - before) < 2) {
        el.scrollIntoView({ behavior, block: 'start' })
      }
    }, 120)
  }

  // 读下载信息（免登录接口）
  useEffect(() => {
    let alive = true
    fetch('/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LatestJson | null) => {
        if (alive && d) setDesktop(d)
      })
      .catch(() => {})
    fetch('/api/pda/version', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: PdaVersionData } | null) => {
        if (alive && d?.data) setPda(d.data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const desktopUrl = desktop?.url ? (desktop.url.startsWith('http') ? desktop.url : `${desktop.url}`) : ''
  const pdaVersion = pda?.version || ''

  return (
    <div className="landing-page min-h-screen bg-[#F5F7FA] font-sans text-[#0E1B2E] antialiased">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#0B3B8C] text-white">
              <Layers className="size-4.5" />
            </div>
            <span className="text-base font-bold tracking-tight text-[#0E1B2E]">{BRAND.name}</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-widest text-slate-400 sm:inline">
              {BRAND.tagline}
            </span>
          </div>
          <nav className="flex items-center gap-1 text-sm text-slate-600">
            <button type="button" onClick={scrollToSection('features')} className="hidden rounded-lg px-3 py-1.5 transition hover:bg-slate-100 sm:inline">能力</button>
            <button type="button" onClick={scrollToSection('download')} className="hidden rounded-lg px-3 py-1.5 transition hover:bg-slate-100 sm:inline">下载</button>
            <button type="button" onClick={scrollToSection('values')} className="hidden rounded-lg px-3 py-1.5 transition hover:bg-slate-100 sm:inline">为什么选我们</button>
            <a
              href="#/login"
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-[#1E5AE6] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#1749C4]"
            >
              进入系统
              <ArrowRight className="size-3.5" />
            </a>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0E1B2E] text-white">
        {/* 背景：极淡的网格线 */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="pointer-events-none absolute -right-40 -top-40 size-[30rem] rounded-full bg-[#1E5AE6]/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-20 sm:px-8 lg:grid-cols-2 lg:px-10 lg:pt-24">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-blue-200">
              <span className="inline-block size-1.5 rounded-full bg-[#6EA8FF]" />
              ERP / WMS 一体化 · 扫码驱动仓库作业
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              让每一件货，
              <br />
              <span className="text-[#6EA8FF]">都在系统的轨道上流动。</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-blue-100/80">
              {BRAND.subclaim}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#/login"
                className="inline-flex items-center gap-2 rounded-xl bg-[#1E5AE6] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:bg-[#1749C4]"
              >
                进入系统
                <ArrowRight className="size-4" />
              </a>
              {desktopUrl ? (
                <a
                  href={desktopUrl}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  <Download className="size-4" />
                  下载桌面端
                  {desktop?.version && <span className="text-blue-200/70">v{desktop.version}</span>}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={scrollToSection('download')}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  <Download className="size-4" />
                  查看下载方式
                </button>
              )}
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-blue-200/60">
              <span>✓ 网页即用，无需安装</span>
              <span>✓ 桌面端支持离线打印</span>
              <span>✓ PDA 现场作业</span>
            </div>
          </div>

          <Reveal>
            <WorkbenchMockup />
          </Reveal>
        </div>
      </section>

      {/* ── 能力矩阵 ─────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24 sm:px-8 lg:px-10">
        <Reveal className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">从采购下单到客户结算，全在一个系统闭环</h2>
          <p className="mt-3 text-sm text-slate-500">六大业务模块共用一份数据，进销存与财务一体联动。</p>
        </Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Reveal key={m.title}>
              <a
                href={m.href}
                className="group flex h-full items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#1E5AE6]/40 hover:shadow-lg hover:shadow-blue-900/5"
              >
                <div className={`mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl ${m.color}`}>
                  <m.icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">{m.title}</h3>
                    <ArrowUpRight className="size-4 shrink-0 text-slate-300 transition group-hover:text-[#1E5AE6]" />
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{m.desc}</p>
                  <span className="mt-2 inline-block text-xs font-medium text-[#1E5AE6]">
                    进入模块 →
                  </span>
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── 下载 ─────────────────────────────────────────────── */}
      <section id="download" className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-10">
          <Reveal className="mx-auto mb-14 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">三端随时可用</h2>
            <p className="mt-3 text-sm text-slate-500">网页端打开即用；桌面端与 PDA 安装包随时下载。</p>
          </Reveal>

          <div className="grid gap-5 md:grid-cols-2">
            {/* 桌面端 */}
            <Reveal>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-[#F5F7FA] p-7">
                <div className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-[#0B3B8C] text-white">
                  <Download className="size-5" />
                </div>
                <h3 className="text-lg font-semibold">桌面端（Windows）</h3>
                <p className="mt-1 flex-1 text-sm text-slate-500">
                  适合办公室高频操作与打印机管理。支持本地 RAW 打印、自动更新、离线上传。
                  {desktop?.version && <span className="mt-1 block text-slate-400">当前版本 v{desktop.version}</span>}
                </p>
                {desktopUrl ? (
                  <a
                    href={desktopUrl}
                    className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-[#1E5AE6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1749C4]"
                  >
                    <Download className="size-4" />
                    下载 Windows 安装包
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={scrollToSection('values')}
                    className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-[#1E5AE6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1749C4]"
                  >
                    <Download className="size-4" />
                    桌面端即将开放下载
                  </button>
                )}
                <p className="mt-3 text-xs text-slate-400">下载后双击安装，首次登录即可使用。</p>
              </div>
            </Reveal>

            {/* PDA */}
            <Reveal>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-[#F5F7FA] p-7">
                <div className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-[#0B3B8C] text-white">
                  <Smartphone className="size-5" />
                </div>
                <h3 className="text-lg font-semibold">PDA 手持端（Android）</h3>
                <p className="mt-1 flex-1 text-sm text-slate-500">
                  仓库现场作业专用：收货、上架、拣货、分拣、复核、打包、出库、盘点全流程扫码。
                  {pdaVersion && <span className="mt-1 block text-slate-400">当前版本 v{pdaVersion}</span>}
                </p>
                <a
                  href="/api/pda/download"
                  className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-[#1E5AE6] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1749C4]"
                >
                  <Smartphone className="size-4" />
                  下载 PDA 安装包
                </a>
                <p className="mt-3 text-xs text-slate-400">Android 设备扫码安装，登录后在「设备绑定」页完成绑定。</p>
              </div>
            </Reveal>
          </div>

          <Reveal className="mt-6">
            <p className="rounded-xl border border-dashed border-slate-300 bg-[#F5F7FA] px-5 py-4 text-center text-sm text-slate-500">
              想先体验？直接
              <a href="#/login" className="mx-1 font-medium text-[#1E5AE6] hover:underline">进入系统</a>
              —— 网页端打开即用，无需任何安装。
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── 为什么选我们 ─────────────────────────────────────── */}
      <section id="values" className="bg-[#0E1B2E] py-24 text-white">
        <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-10">
          <div className="mb-14 grid gap-6 lg:grid-cols-2 lg:items-end">
            <Reveal>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">为仓库现场的可靠性而设计</h2>
            </Reveal>
            <Reveal className="lg:justify-self-end">
              <p className="max-w-md text-sm leading-relaxed text-blue-100/70 lg:text-right">
                扫码驱动、数据一致、打印解耦——每一个设计取舍，都是为了让现场作业不卡壳、账面不出错。
              </p>
            </Reveal>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {VALUES.map((v) => (
              <Reveal key={v.title}>
                <a
                  href={v.href}
                  className="group block h-full rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-white/25 hover:bg-white/10"
                >
                  <h3 className="mb-2 flex items-center justify-between text-base font-semibold text-white">
                    {v.title}
                    <ArrowUpRight className="size-4 text-blue-200/40 transition group-hover:text-[#6EA8FF]" />
                  </h3>
                  <p className="text-sm leading-relaxed text-blue-100/70">{v.desc}</p>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 页脚 ─────────────────────────────────────────────── */}
      <footer className="bg-[#0E1B2E] py-12 text-blue-200/50">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-14 text-center sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-white/10 text-white">
              <Layers className="size-4" />
            </div>
            <span className="text-sm font-semibold text-white">{BRAND.name}</span>
          </div>
          <div className="text-xs leading-relaxed">
            <p>企业管理系统 · ERP / WMS 一体化</p>
            <p className="mt-2 font-medium text-blue-100/70">联系我们</p>
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <a href={`tel:${CONTACT.phone}`} className="inline-flex items-center gap-1.5 text-blue-200/70 transition hover:text-white">
                <Phone className="size-3.5" />
                {CONTACT.phone}
              </a>
              <a href={`mailto:${CONTACT.email}`} className="inline-flex items-center gap-1.5 text-blue-200/70 transition hover:text-white">
                <Mail className="size-3.5" />
                {CONTACT.email}
              </a>
            </p>
            <p className="mt-1 text-blue-200/40">联系人：{CONTACT.name}</p>
          </div>
          <a
            href="#/login"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
          >
            进入系统
            <ArrowRight className="size-3.5" />
          </a>
          <p className="text-[11px] text-blue-200/30">© {new Date().getFullYear()} 极序 Flow · jixuflow.com</p>
        </div>
      </footer>
    </div>
  )
}
