/** 官网融合已确认的新稿布局与旧版交互演示，发布信息继续来自原公开接口。 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import SystemBrand from '@/components/shared/SystemBrand'
import { landingUpdates } from '../landing/updates'
import ProductDemo from '../landing/ProductDemo'
import BusinessStory from '../landing/BusinessStory'
import { capabilityGroups } from '../landing/product-content'
import { installLandingMotion } from '../landing/motion'
import '../landing/landing-reference.css'
import '../landing/landing-fusion.css'
import '../landing/landing-sections.css'

type Desktop = { version?: string; url?: string } | null
function DesktopDownload({ desktop, loading, className, children }: { desktop: Desktop; loading: boolean; className: string; children: ReactNode }) {
  const url = desktop?.url && /^(https?:\/\/|\/(?!\/))/.test(desktop.url) ? desktop.url : null
  return url ? <a className={className} href={url}>{children}</a> : <button className={className} disabled>{loading ? '正在获取安装包…' : '暂未获取到安装包'}</button>
}
function ReleaseList() {
  return <div className="release-list">{landingUpdates.slice(0, 3).map(item => <div className="logrow" key={item.version}>
    <div><div className="v num">v{item.version}</div><span className="tag">{item.category}</span></div>
    <div><h3>{item.title}</h3><ul>{item.details.slice(0, 3).map(detail => <li key={detail}>{detail}</li>)}</ul></div>
  </div>)}</div>
}
function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault()
  const target = document.getElementById(id)
  if (!target) return
  const header = target.closest('.official-site')?.querySelector('header')
  const offset = (header?.getBoundingClientRect().height ?? 66) + 18
  window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - offset), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previousTitle = document.title
    document.title = '极序 Flow — 业务有序，经营有数（电脑版）'
    const stop = root.current ? installLandingMotion(root.current) : undefined
    return () => { stop?.(); document.title = previousTitle }
  }, [])
  const [desktop, setDesktop] = useState<{
    version?: string;
    url?: string;
  } | null>(null);
  const [pdaVersion, setPdaVersion] = useState("");
  const [downloadsLoading, setDownloadsLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    // 公共版本信息失败时呈现不可用；不注入登录态或读取经营数据。
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    async function load() {
      await Promise.allSettled([
        fetch("/latest.json", { cache: "no-store", signal: controller.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (controller.signal.aborted) return;
            if (data && typeof data === "object")
              setDesktop({
                version:
                  typeof data.version === "string" ? data.version : undefined,
                url: typeof data.url === "string" ? data.url : undefined,
              });
          }),
        fetch("/api/pda/version", {
          cache: "no-store",
          signal: controller.signal,
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (
              !controller.signal.aborted &&
              typeof data?.data?.version === "string"
            )
              setPdaVersion(data.data.version);
          }),
      ]);
      window.clearTimeout(timeout);
      setDownloadsLoading(false);
    }
    void load();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  return <div className="official-site" ref={root}>

<header>
  <div className="side hd">
    <div className="official-brand"><SystemBrand /><div className="brand">极序 Flow<small>ERP / WMS</small></div></div>
    <nav>
      <a href="#product" onClick={event => jump(event, "product")}>产品</a><a href="#flow" onClick={event => jump(event, "flow")}>流程</a><a href="#modules" onClick={event => jump(event, "modules")}>模块</a><a href="#ends" onClick={event => jump(event, "ends")}>三端</a><a href="#log" onClick={event => jump(event, "log")}>更新日志</a><a href="#download" onClick={event => jump(event, "download")}>下载</a>
    </nav>
    <a className="btn btn-line" href="#/login">进入系统</a>
    <a className="btn btn-ink" href="#download" onClick={event => jump(event, "download")}>下载客户端</a>
  </div>
</header>

<div className="side hero" id="product">
  <div className="hero-ghost" aria-hidden="true">序</div>
    <div className="eyebrow"><span>为有仓库的生意而做</span></div>
  <h1>业务有序，<br /><em>经营有数。</em></h1>
  <p className="sub">从订单到出库，从库存到账款。<br />一处看清，协同完成。</p>
  <div className="cta-row">
    <a className="btn btn-ink" href="#download" onClick={event => jump(event, "download")}>开始使用</a>
    <a className="btn btn-line" href="#product-demo" onClick={event => jump(event, "product-demo")}>探索产品 <span aria-hidden="true">↗</span></a>
  </div>
  <p className="fine">Windows 桌面端 · PDA 手持端 · 浏览器版，<span>三端同一套数据</span></p>
  <div className="stage" id="product-demo">
    <div className="fusion-demo"><ProductDemo /></div>
  </div>
</div>

<div className="side site-stats">
  <div className="stats">
    <div className="stat"><div className="v">业务相连</div><div className="k">采购、销售、仓储与财务，沿同一条业务线衔接。</div></div>
    <div className="stat"><div className="v">三端协作</div><div className="k">桌面、PDA 与浏览器，查看和处理同一份数据。</div></div>
    <div className="stat"><div className="v">库存有据</div><div className="k">库存条码记录货物变化，每一步操作都有迹可查。</div></div>
  </div>
</div>

<section className="side site-section" id="warehouse">
  <div className="split">
    <div>
      <div className="eyebrow sec-eyebrow">仓储作业</div>
      <h2>库存的账，只有一本。</h2>
      <p className="lede">从入库到出库，用库存条码串起每一步。<br />查得到数量，也查得到来源与操作记录。</p>
      <ul className="checks">
        <li>批次拣货<span>— 一批订单合并成一个批次，一趟走完</span></li>
        <li>占库锁定<span>— 订单一确认就锁库存，不会卖超</span></li>
        <li>盘点差异<span>— 当场定位到库存条码和批次</span></li>
      </ul>
        <div className="spec"><span>多仓多库位</span><span>批次管理</span><span>按仓库范围授权</span></div>
    </div>
    <div className="mini">
      <div className="mh"><b>拣货清单 · 示例</b><span>华东一仓</span></div>
      <div className="mrow"><span>缓冲铰链 · 全盖</span><span className="pill">A-03 库存条码</span></div>
      <div className="mrow"><span>隐藏式导轨 · 450mm</span><span className="pill">B-11 库存条码</span></div>
      <div className="mrow"><span>上翻支撑 · 标准型</span><span className="pill">A-07 库存条码</span></div>
      <div className="mrow"><span>本批次 · 3 个品类</span><span className="num">一趟走完</span></div>
    </div>
  </div>
</section>

<section className="side site-section" id="finance">
  <div className="alt">
    <div className="split">
      <div className="mini">
        <div className="mh"><b>凭证分录 · 示例</b><span>销售出库单 XK-0931</span></div>
        <div className="mrow"><span>借 · 主营业务成本</span><span className="num">¥48,210.00</span></div>
        <div className="mrow"><span>贷 · 库存商品</span><span className="num">¥48,210.00</span></div>
        <div className="mrow"><span>借 · 应收账款</span><span className="num">¥62,480.00</span></div>
        <div className="mrow"><span>贷 · 主营业务收入</span><span className="num">¥62,480.00</span></div>
        <div className="mrow"><span>状态</span><span className="pill">借贷平衡 · 已生成</span></div>
      </div>
      <div>
        <div className="eyebrow sec-eyebrow">财务与会计</div>
        <h2><span>业务走完，</span><span>账自动跟上。</span></h2>
        <p className="lede">业务单据衔接应收应付和会计凭证。<br />少一次重复录入，月末仍可按来源核对。</p>
        <ul className="checks">
          <li>应收应付<span>— 跟着订单走，该收该付一目了然</span></li>
          <li>收付款核销<span>— 按分金额核对，差一分也标出来</span></li>
          <li>成本来源<span>— 每个数字都能查到来源单据</span></li>
        </ul>
          <div className="spec"><span>凭证模板可配置</span><span>核销精确到分</span><span>成本来源可追溯</span></div>
      </div>
    </div>
  </div>
</section>

<section className="side site-section" id="flow">
  <h2>不多一步，不漏一单。</h2>
  <ol className="flow">
    <li className="step"><div className="n">01</div><div className="t">销售下单</div><div className="d">确认订单，核对价格与交期</div></li>
    <li className="step"><div className="n">02</div><div className="t">系统占库</div><div className="d">按商品占库，保留供货依据</div></li>
    <li className="step"><div className="n">03</div><div className="t">批次拣货</div><div className="d">同区订单合成批次，按任务扫码</div></li>
    <li className="step"><div className="n">04</div><div className="t">复核出库</div><div className="d">扫码复核，核对数量后出库</div></li>
    <li className="step"><div className="n">05</div><div className="t">物流跟踪</div><div className="d">运单关联订单，跟踪运输进度</div></li>
    <li className="step"><div className="n">06</div><div className="t">对账收款</div><div className="d">应收有来源，收款按单核销</div></li>
    <li className="step"><div className="n">07</div><div className="t">凭证入账</div><div className="d">收入与成本，按业务生成凭证</div></li>
  </ol>
  <div className="fusion-story"><BusinessStory /></div>
</section>


<section className="side site-section" id="compare">
  <h2><span>老办法不是不行，</span><span>是对不上。</span></h2>
  <div className="cmp">
    <div className="cmp-hd"><span>每天的事</span><span>老办法</span><span className="b">用极序 Flow</span></div>
    <div className="cmpr"><span className="t">库存记账</span><span className="o">记在好几张表里，月底对不上</span><span className="n">只认库存条码，一本账</span></div>
    <div className="cmpr"><span className="t">拣货发货</span><span className="o">一张订单跑一趟仓库</span><span className="n">批次合并，一趟走完</span></div>
    <div className="cmpr"><span className="t">月底对账</span><span className="o">全员停下来对单据</span><span className="n">按单核对，实际结算精确到分</span></div>
    <div className="cmpr"><span className="t">临时查数</span><span className="o">翻聊天记录和 Excel</span><span className="n">打开系统，一处看清</span></div>
    <div className="cmpr"><span className="t">财务制证</span><span className="o">对着单据手工录分录</span><span className="n">凭证引擎自动生成</span></div>
  </div>
</section>

<section className="side site-section" id="modules">
  <h2>生意要用的，都在里面。</h2>
  <div className="mods">
    {capabilityGroups.map(item => <article className="mod" key={item.title}>
      <h3>{item.title}</h3><p>{item.description}</p>
      <a className="fusion-module-link" href={item.route}>{item.link}<span aria-hidden="true"> ›</span></a>
    </article>)}
  </div>
</section>

<section className="side site-section" id="ends">
  <h2><span>办公室、仓库、路上，</span><span>同一个系统。</span></h2>
  <div className="device-showcase" aria-label="桌面与手持端协作示意">
    <div className="device-desktop" aria-hidden="true">
      <div className="device-bar"><span><SystemBrand /> 极序 Flow</span><span>工作台 · 示例</span></div>
      <div className="device-workspace">
        <div className="device-sidebar"><span className="selected">销售管理</span><span>库存管理</span><span>仓库任务</span><span>财务会计</span></div>
        <div className="device-orders">
          <div className="device-heading"><b>销售订单</b><span>办公室 · 桌面端</span></div>
          <div className="device-order"><b>缓冲铰链 · 全盖</b><span>80 件</span><span>待履约</span></div>
          <div className="device-order"><b>隐藏式导轨 · 450mm</b><span>40 套</span><span>待复核</span></div>
          <div className="device-order"><b>上翻支撑 · 标准型</b><span>20 套</span><span>待出库</span></div>
          <div className="device-sync">同一张订单，衔接下一步作业。</div>
        </div>
      </div>
    </div>
    <div className="device-handheld" aria-hidden="true">
      <div className="device-speaker" />
      <div className="device-screen">
        <span>仓库 · PDA</span><b>复核任务</b>
        <div className="device-barcode" />
        <strong>缓冲铰链 · 全盖</strong><p>任务数量 <b>80 件</b></p>
        <div className="device-action">扫码复核</div>
      </div>
    </div>
  </div>
  <div className="ends" id="download">
    <div className="end">
      <b>桌面端 · Windows</b>
      <p>装在办公室电脑上用。单据、报表、打印都稳，适合坐班处理业务。</p>
      <small>Windows 10 及以上 · 版本以发布信息为准</small>
      <DesktopDownload desktop={desktop} loading={downloadsLoading} className="">下载安装包</DesktopDownload>
    </div>
    <div className="end">
      <b>PDA 手持端</b>
      <p>装到仓库手持设备上。收货、上架、拣货、盘点，扫码即走。</p>
      <small>适用于 Android 手持设备 · 作业前需绑定设备与仓库{pdaVersion && ` · v${pdaVersion}`}</small>
      <a href="/api/pda/download">下载 PDA 版</a>
    </div>
    <div className="end">
      <b>浏览器网页版</b>
      <p>免安装，打开浏览器登录就能用。管理者在哪，仓库就在哪。</p>
      <small>使用已有企业账号登录</small>
      <a href="#/login">打开网页版</a>
    </div>
  </div>

</section>



<section className="side site-section" id="start">
  <h2>三步，今天就能用上。</h2>
  <div className="starts">
    <div className="stp2"><div className="n">01</div><b>下载安装</b><p>桌面端适用于Windows 10 及以上，下载完装好就能打开。</p></div>
    <div className="stp2"><div className="n">02</div><b>登录账号</b><p>用企业账号登录桌面端；网页版同一个账号，打开浏览器直接用。</p></div>
    <div className="stp2"><div className="n">03</div><b>绑定 PDA</b><p>手持设备安装 PDA 版，绑定所在仓库，再开始扫码作业。</p></div>
  </div>
</section>

<section className="side site-section" id="log">
  <div className="eyebrow sec-eyebrow">版本更新</div>
  <h2>一直在变好。</h2>
  <ReleaseList />  <p style={{"fontSize": "12.5px", "color": "var(--faint)", "marginTop": "22px"}}>以上均为安装验收版本，仅供合成数据安装验收；每个版本发布前都走完整回归与安装包校验。</p>
</section>

<section className="side site-section" id="faq">
  <h2>先问清楚，再开始。</h2>
  <div className="fq">
    <details><summary>对电脑和系统有什么要求？</summary><p>桌面端运行在 Windows 10 及以上，安装包以下载区发布信息为准。网页版用主流浏览器的近期版本即可打开，不需要安装。</p></details>
    <details><summary>PDA 在仓库里怎么用？</summary><p>给 Android 手持设备装上 PDA 版，首次使用时把设备与所在仓库绑定，之后收货、上架、拣货、盘点都扫码完成，数据实时回传。设备丢失或人员变动时，管理员可以吊销它的访问权限。</p></details>
    <details><summary>桌面、PDA、网页版的数据是同一份吗？</summary><p>是同一套系统、同一份数据。在办公室改的单，仓库 PDA 上立刻能看到；仓库扫码入的库，办公室的库存和账上同步更新。</p></details>
    <details><summary>版本怎么更新？</summary><p>桌面端、PDA 与服务按版本配套发布，更新内容写在上方的更新日志里。升级前系统会做备份核对，历史数据保留。</p></details>
    <details><summary>现在是什么阶段，收费怎么算？</summary><p>当前版本与更新内容以本页发布信息为准，适合先用测试数据走通流程、验收设备和打印。收费按企业规模与使用方式确认，电话里聊清楚再定，具体方案沟通确认。</p></details>
  </div>
</section>
<div className="side fin site-closing">
  <h2>业务有序，经营有数。</h2>
  <p>下载桌面端，装好就能开始今天的业务。</p>
  <div className="cta-row">
    <DesktopDownload desktop={desktop} loading={downloadsLoading} className="btn btn-ink">下载 Windows 版</DesktopDownload>
    <a className="btn btn-line" href="tel:15701178441">电话聊聊 · 157 0117 8441</a>
  </div>
</div>

<footer className="site-footer">
  <div className="side">
    <div className="ft">
      <div className="c">
        <b>极序 Flow</b>
        <p>为有仓库的生意，理顺每一天。<br />ERP / WMS 企业管理系统</p>
      </div>
      <div className="c"><h4>产品</h4><div className="lk">
        <a href="#download" onClick={event => jump(event, "download")}>桌面端 · Windows</a><a href="#download" onClick={event => jump(event, "download")}>PDA 手持端</a><a href="#/login">浏览器网页版</a><a href="#log" onClick={event => jump(event, "log")}>更新日志</a><a href="#faq" onClick={event => jump(event, "faq")}>常见问题</a>
      </div></div>
      <div className="c"><h4>模块</h4><div className="lk">
        <a href="#modules" onClick={event => jump(event, "modules")}>采购</a><a href="#modules" onClick={event => jump(event, "modules")}>销售</a><a href="#modules" onClick={event => jump(event, "modules")}>仓储</a><a href="#modules" onClick={event => jump(event, "modules")}>物流</a><a href="#modules" onClick={event => jump(event, "modules")}>财务</a><a href="#modules" onClick={event => jump(event, "modules")}>会计</a>
      </div></div>
      <div className="c">
        <h4>聊聊你的业务</h4>
        <p style={{"marginTop": "0"}}>电话<br /><a className="ft-tel" href="tel:15701178441">157 0117 8441</a><br />邮箱 · 15701178441@139.com</p>
      </div>
    </div>
    <div className="ft-legal"><span>© 2026 极序 Flow</span><span>ERP / WMS 企业管理系统</span><span>{desktop?.version ? `当前桌面版本 v${desktop.version}` : "版本信息以发布清单为准"}</span></div>
  </div>
</footer>

</div>
}
