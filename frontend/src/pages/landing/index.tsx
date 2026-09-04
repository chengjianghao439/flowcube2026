/** 官网独立展示页：页内导航不修改 hash，业务入口仍由既有路由鉴权。 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  Layers,
  Menu,
  Monitor,
  Phone,
  Mail,
  Package,
  Pause,
  Play,
  History,
  ScanLine,
  ClipboardList,
  Warehouse,
  ShoppingCart,
  ListChecks,
  Truck,
  ReceiptText,
  Smartphone,
  X,
} from "lucide-react";
import "./landing.css";
import { landingUpdates } from "./updates";
import { productScenes as scenes, capabilityGroups } from "./product-content";
import SupplyStory from "./SupplyStory";

const nav = [
  ["业务全景", "experience"],
  ["核心能力", "features"],
  ["三端协作", "devices"],
  ["版本更新", "updates"],
  ["下载使用", "downloads"],
] as const;

function Brand() {
  return (
    <span className="flow-brand">
      <span className="flow-logo">
        <Layers size={23} strokeWidth={2.4} />
      </span>
      极序 <b>Flow</b>
    </span>
  );
}

export default function LandingPage() {
  const [active, setActive] = useState(0);
  const [activeSection, setActiveSection] = useState("");
  const [motionPaused, setMotionPaused] = useState(false);
  const siteRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktop, setDesktop] = useState<{
    version?: string;
    url?: string;
  } | null>(null);
  const [pdaVersion, setPdaVersion] = useState("");
  const scene = scenes[active];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/latest.json", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === "object") setDesktop(d);
      })
      .catch(() => {});
    fetch("/api/pda/version", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (typeof d?.data?.version === "string") setPdaVersion(d.data.version);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 760) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  useEffect(() => {
    const root = siteRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("flow-in-view");
            reveal.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.16 },
    );
    root
      .querySelectorAll("[data-flow-reveal]")
      .forEach((element) => reveal.observe(element));
    const navigation = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            setActiveSection(entry.target.id === "home" ? "" : entry.target.id);
        }
      },
      { rootMargin: "-12% 0px -65% 0px" },
    );
    root
      .querySelectorAll("main > section[id]")
      .forEach((element) => navigation.observe(element));
    return () => {
      reveal.disconnect();
      navigation.disconnect();
    };
  }, []);

  function go(id: string) {
    setMenuOpen(false);
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }
  // 下载清单不可用时明确展示状态；不把登录页伪装成安装包下载。
  const desktopUrl =
    typeof desktop?.url === "string" &&
    /^(https?:\/\/|\/(?!\/))/.test(desktop.url)
      ? desktop.url
      : "";

  return (
    <div className="flow-site" ref={siteRef} data-motion-paused={motionPaused}>
      <a
        className="flow-skip"
        href="#experience"
        onClick={(event) => {
          event.preventDefault();
          go("experience");
          document.getElementById("experience")?.focus();
        }}
      >
        跳到产品体验
      </a>
      <header className="flow-header">
        <button
          className="flow-brand-button"
          aria-label="返回官网顶部"
          onClick={() => go("home")}
        >
          <Brand />
        </button>
        <nav className="flow-nav" aria-label="官网导航">
          {nav.map(([name, id]) => (
            <button
              key={id}
              aria-current={activeSection === id ? "location" : undefined}
              onClick={() => go(id)}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="flow-header-actions">
          <a href="#/login">
            进入系统 <ArrowRight size={15} />
          </a>
          <button className="flow-button small" onClick={() => go("downloads")}>
            下载客户端
          </button>
          <button
            className="flow-menu"
            aria-label={menuOpen ? "关闭导航" : "打开导航"}
            aria-expanded={menuOpen}
            aria-controls="flow-mobile-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && (
          <nav
            id="flow-mobile-nav"
            className="flow-mobile-nav"
            aria-label="移动端导航"
          >
            {nav.map(([name, id]) => (
              <button
                key={id}
                aria-current={activeSection === id ? "location" : undefined}
                onClick={() => go(id)}
              >
                {name}
                <ChevronRight size={16} />
              </button>
            ))}
          </nav>
        )}
      </header>

      <main>
        <section className="flow-hero" id="home">
          <div className="flow-orbit" aria-hidden="true">
            <span>FLOW</span>
            <i />
            <i />
            <i />
          </div>
          <div className="flow-hero-content">
            <p className="flow-intro">
              <span /> 采购 · 销售 · 仓储 · 财务 · 会计
            </p>
            <h1
              className="flow-brand-headline"
              aria-label="业务有序，经营有数。"
            >
              <span className="flow-headline-row" aria-hidden="true">
                <span>业务</span>
                <strong>
                  有序<span className="flow-headline-comma">，</span>
                </strong>
              </span>
              <span className="flow-headline-row" aria-hidden="true">
                <span>经营</span>
                <strong>
                  有数<span className="flow-headline-period">。</span>
                </strong>
              </span>
            </h1>
            <p className="flow-hero-description">
              从采购到交付，从库存到账款，
              <br className="flow-desktop-break" />
              极序 Flow 让每一步业务清晰衔接。
            </p>
            <div className="flow-hero-buttons">
              <a className="flow-button" href="#/login">
                进入极序 Flow <ArrowRight size={18} />
              </a>
              <button
                className="flow-button secondary"
                onClick={() => go("experience")}
              >
                先看看怎么用 <ArrowDown size={17} />
              </button>
            </div>
            <p className="flow-hero-meta">
              浏览器打开即用 <span>·</span> Windows 桌面办公 <span>·</span>{" "}
              Android PDA 作业
            </p>
          </div>
          <div className="flow-cargo" aria-hidden="true">
            <div className="flow-cube cube-one">
              <Layers />
            </div>
            <div className="flow-cube cube-two">
              <Package />
            </div>
            <span className="flow-cargo-label">
              <Check size={13} /> 流程已衔接
            </span>
          </div>
        </section>

        <section
          className="flow-experience flow-container"
          id="experience"
          tabIndex={-1}
          aria-label="产品交互演示"
        >
          <div className="flow-experience-toolbar">
            <span>从补货到结账，看看各环节实际在做什么</span>
            <button
              className="flow-motion-toggle"
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((value) => !value)}
            >
              {motionPaused ? <Play size={13} /> : <Pause size={13} />}
              {motionPaused ? "播放页面动效" : "暂停页面动效"}
            </button>
          </div>
          <div className="flow-demo-window">
            <div className="flow-window-bar">
              <span className="flow-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>极序 Flow · 业务工作台</span>
              <span className="flow-demo-label">演示数据</span>
            </div>
            <div className="flow-demo-body">
              <aside className="flow-demo-sidebar">
                <Brand />
                <p>从业务计划，到现场执行</p>
                <div
                  className="flow-scene-tabs"
                  role="tablist"
                  aria-label="业务场景"
                  aria-orientation="vertical"
                >
                  {scenes.map((item, index) => (
                    <button
                      key={item.name}
                      id={`scene-tab-${index}`}
                      role="tab"
                      aria-selected={active === index}
                      aria-controls="flow-scene-panel"
                      tabIndex={active === index ? 0 : -1}
                      onClick={() => setActive(index)}
                      onKeyDown={(event) => {
                        if (
                          ![
                            "ArrowDown",
                            "ArrowUp",
                            "ArrowRight",
                            "ArrowLeft",
                            "Home",
                            "End",
                          ].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? scenes.length - 1
                              : (index +
                                  (["ArrowDown", "ArrowRight"].includes(
                                    event.key,
                                  )
                                    ? 1
                                    : -1) +
                                  scenes.length) %
                                scenes.length;
                        setActive(next);
                        document.getElementById(`scene-tab-${next}`)?.focus();
                      }}
                    >
                      <span>{["◈", "↗", "▦", "↩", "◎"][index]}</span>
                      {item.name}
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
                <div className="flow-demo-user">
                  <span>极</span>
                  <div>
                    极序示例企业<small>业务协作空间</small>
                  </div>
                </div>
              </aside>
              <div
                className="flow-scene"
                id="flow-scene-panel"
                role="tabpanel"
                aria-labelledby={`scene-tab-${active}`}
                tabIndex={0}
              >
                <div className="flow-scene-top">
                  <span>工作台 / {scene.name}</span>
                  <span>
                    <i /> 业务协同中
                  </span>
                </div>
                <div className="flow-scene-heading" key={`heading-${active}`}>
                  <div>
                    <h2>{scene.title}</h2>
                    <p>{scene.description}</p>
                  </div>
                  <span className="flow-scene-icon">
                    <Package size={28} />
                  </span>
                </div>
                <div className="flow-table-wrap">
                  <table>
                    <caption className="flow-sr-only">
                      {scene.name}示例记录，非真实业务数据
                    </caption>
                    <thead>
                      <tr>
                        {scene.columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody key={active}>
                      {scene.rows.map((row, index) => (
                        <tr key={row[0]}>
                          {row.map((value, cell) => (
                            <td key={cell}>
                              {cell === 3 && scene.name !== "财务会计" ? (
                                <span className={`flow-status status-${index}`}>
                                  {value}
                                </span>
                              ) : (
                                value
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flow-demo-event">
                  <span className="flow-event-check">
                    <Check size={17} />
                  </span>
                  <div>
                    <strong>{scene.label}</strong>
                    <p>{scene.note}</p>
                  </div>
                  <span className="flow-event-line" />
                </div>
                <a className="flow-scene-link" href={scene.route}>
                  进入系统查看{scene.name}
                  <ArrowRight size={15} />
                </a>
              </div>
            </div>
          </div>
          <p className="flow-demo-caption">
            以上为业务能力示意，非真实页面截图或经营数据；实际操作按账号权限与业务配置执行。
          </p>
        </section>

        <section className="flow-story flow-container" id="features">
          <div className="flow-section-heading">
            <p>前一环节的结果，是下一环节的依据。</p>
            <h2>
              让销售的承诺，
              <br />
              <span>有采购和仓库接得住。</span>
            </h2>
          </div>
          <SupplyStory />
          <div className="flow-journey" data-flow-reveal>
            {[
              { label: "计划采购", icon: ClipboardList },
              { label: "收货上架", icon: Warehouse },
              { label: "销售占库", icon: ShoppingCart },
              { label: "拣货分拣", icon: ListChecks },
              { label: "复核出库", icon: Truck },
              { label: "对账结算", icon: ReceiptText },
            ].map(({ label, icon: Icon }, index) => (
              <div key={label}>
                <span className="flow-journey-node">
                  <Icon size={20} />
                </span>
                <h3>{label}</h3>
                <p>
                  {
                    [
                      "来货有计划",
                      "商品有位置",
                      "承诺有依据",
                      "作业有指引",
                      "交付有记录",
                      "账款有来源",
                    ][index]
                  }
                </p>
              </div>
            ))}
          </div>
          <div className="flow-capability-heading">
            <h3>业务不止出入库，管理也不止记数量。</h3>
            <p>把相关工作放回同一套系统里，保留各自的处理流程。</p>
          </div>
          <div className="flow-capability-list">
            {capabilityGroups.map((item) => (
              <article key={item.title}>
                <h4>{item.title}</h4>
                <p>{item.description}</p>
                <a href={item.route}>
                  {item.link}
                  <ArrowRight size={14} />
                </a>
              </article>
            ))}
          </div>
          <div className="flow-exceptions">
            <h3>发生变化时，也有后续处理。</h3>
            <div>
              <details>
                <summary>
                  订单改了，已经拣出的货怎么办？
                  <ChevronRight size={16} />
                </summary>
                <p>
                  执行期减量或取消，涉及已经搬动的物料时，通过 PDA
                  物理确认与逆向归还处理；已出库部分保留原有发货事实。
                </p>
              </details>
              <details>
                <summary>
                  退回的货，能直接增加可用库存吗？
                  <ChevronRight size={16} />
                </summary>
                <p>
                  销售退货先收货、再质检。合格、拒收、未检数量分别保留，合格部分上架后才进入可用实物；退货同时关联账款处理。
                </p>
              </details>
              <details>
                <summary>
                  盘点时账面又变了，怎么办？
                  <ChevronRight size={16} />
                </summary>
                <p>
                  提交盘点前检查账面变化；发现变化时拒绝整单提交，需刷新账面并重新核对受影响的实盘数量，避免拿旧账面调整库存。
                </p>
              </details>
            </div>
          </div>
        </section>

        <section className="flow-devices" id="devices">
          <div className="flow-container flow-device-grid">
            <div className="flow-device-copy">
              <p className="flow-section-kicker">
                办公室管业务，仓库按任务执行
              </p>
              <h2>
                不同岗位，
                <br />
                各有清楚的下一步。
              </h2>
              <p>
                采购跟进到货，销售查看占库与履约，财务处理账款，会计管理凭证和期间。仓库人员在绑定仓库的
                PDA 上扫码作业，任务进度回到办公室。
              </p>
              <ul>
                <li>
                  <Check size={17} /> 浏览器：处理订单、审批与岗位待办
                </li>
                <li>
                  <Check size={17} /> 桌面端：办公操作、标签打印队列与补打
                </li>
                <li>
                  <Check size={17} /> PDA：绑定仓库，按任务扫码收货、拣货与盘点
                </li>
              </ul>
              <button
                className="flow-text-button"
                onClick={() => go("downloads")}
              >
                选择适合你的客户端 <ArrowRight size={18} />
              </button>
            </div>
            <div
              className="flow-device-art"
              aria-label="桌面工作台与 PDA 扫码作业示意"
            >
              <div className="flow-mini-desktop">
                <div>
                  <Brand />
                  <span>仓库作业 · 示意</span>
                </div>
                <h3>每一项任务，都有下一步。</h3>
                <div className="flow-mini-task">
                  <Package />
                  收货任务<span>已收货</span>
                </div>
                <div className="flow-mini-task">
                  <Layers />
                  容器上架<span>待执行</span>
                </div>
                <div className="flow-mini-task">
                  <Check />
                  库存同步<span>待上架后更新</span>
                </div>
              </div>
              <div className="flow-phone">
                <div className="flow-phone-camera" />
                <span>极序 Flow · PDA</span>
                <h3>扫描，即刻衔接。</h3>
                <div className="flow-scan-target">
                  <ScanLine size={62} strokeWidth={1} />
                </div>
                <p>请扫描容器条码</p>
                <span className="flow-phone-action">扫码作业示意</span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="flow-updates flow-container"
          id="updates"
          aria-labelledby="flow-updates-title"
        >
          <div className="flow-updates-intro">
            <span className="flow-update-icon">
              <History size={25} />
            </span>
            <p className="flow-section-kicker">持续打磨，步步向前</p>
            <h2 id="flow-updates-title">
              每一次更新，
              <br />
              都让日常更顺一点。
            </h2>
            <p>
              从作业细节到系统稳定性，
              <br />
              看看极序 Flow 最近的改进。
            </p>
            <span className="flow-history-note">
              精选版本记录 · 安装版本以下载清单为准
            </span>
            <button
              className="flow-text-button"
              onClick={() => go("downloads")}
            >
              前往下载 <ArrowRight size={16} />
            </button>
          </div>
          <div className="flow-update-list">
            {landingUpdates.map((update, index) => (
              <article
                className="flow-update-entry"
                key={update.version}
                data-flow-reveal
              >
                <div className="flow-update-meta">
                  <span className="flow-version">v{update.version}</span>
                  <span>{update.category}</span>
                  {index === 0 && (
                    <span className="flow-update-recent">近期更新</span>
                  )}
                </div>
                <h3>{update.title}</h3>
                <p>{update.description}</p>
                <details className="flow-update-details">
                  <summary>
                    查看更新详情 <ChevronRight size={15} />
                  </summary>
                  <ul>
                    {update.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </div>
        </section>

        <section className="flow-downloads flow-container" id="downloads">
          <div className="flow-section-heading">
            <p>用你熟悉的设备，开启有序的一天。</p>
            <h2>准备好了，就从这里开始。</h2>
          </div>
          <div className="flow-download-grid">
            <article>
              <Monitor size={30} />
              <h3>Windows 桌面端</h3>
              <p>办公室的日常工作台，支持本地标签打印与自动更新。</p>
              <small>
                {desktop?.version
                  ? `当前版本 v${desktop.version}`
                  : "安装包信息以发布清单为准"}
              </small>
              {desktopUrl ? (
                <a className="flow-button" href={desktopUrl}>
                  <Download size={17} />
                  下载 Windows 版
                </a>
              ) : (
                <button className="flow-button" disabled>
                  暂未获取到安装包
                </button>
              )}
            </article>
            <article>
              <Smartphone size={30} />
              <h3>Android PDA 端</h3>
              <p>为仓库现场准备，从扫码收货到确认出库，一步步完成。</p>
              <small>
                {pdaVersion
                  ? `当前版本 v${pdaVersion}`
                  : "适用于 Android 手持设备"}
              </small>
              <a className="flow-button secondary" href="/api/pda/download">
                <Download size={17} />
                下载 PDA 版
              </a>
            </article>
            <article>
              <Layers size={30} />
              <h3>浏览器直接使用</h3>
              <p>无需安装，在浏览器登录，即可进入企业业务工作台。</p>
              <small>使用已有企业账号登录</small>
              <a className="flow-button secondary" href="#/login">
                进入网页版 <ArrowRight size={17} />
              </a>
            </article>
          </div>
        </section>
      </main>
      <footer className="flow-footer">
        <div className="flow-container">
          <div className="flow-footer-main">
            <div className="flow-footer-brand">
              <Brand />
              <p>
                业务有序，
                <br />
                经营有数。
              </p>
              <span>采购 · 销售 · 仓储 · 财务 · 会计</span>
            </div>
            <nav className="flow-footer-links" aria-label="页脚导航">
              <h2>了解极序</h2>
              {nav.map(([name, id]) => (
                <button key={id} onClick={() => go(id)}>
                  {name}
                </button>
              ))}
            </nav>
            <div className="flow-contact">
              <h2>联系咨询</h2>
              <p>聊聊你的业务与使用需求。</p>
              <a href="tel:15701178441" className="flow-contact-link">
                <span className="flow-contact-icon">
                  <Phone size={18} />
                </span>
                <span>
                  <small>电话沟通</small>
                  <strong>157 0117 8441</strong>
                </span>
                <ArrowRight size={16} />
              </a>
              <a
                href="mailto:15701178441@139.com"
                className="flow-contact-link"
              >
                <span className="flow-contact-icon">
                  <Mail size={18} />
                </span>
                <span>
                  <small>邮件联系</small>
                  <strong>15701178441@139.com</strong>
                </span>
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
          <div className="flow-footer-bottom">
            <p>© {new Date().getFullYear()} 极序 Flow</p>
            <span>ERP / WMS 企业管理系统</span>
            <button onClick={() => go("home")}>
              返回顶部 <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
