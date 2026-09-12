/** 独立工作树中的官网候选版，用户确认前不合并或发布。 */
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  Globe2,
  Mail,
  Menu,
  Monitor,
  Phone,
  ScanLine,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import SystemBrand from "@/components/shared/SystemBrand";
import { capabilityGroups } from "../landing/product-content";
import { landingUpdates } from "../landing/updates";
import ProductDemo from "./ProductDemo";
import BusinessStory from "./BusinessStory";
import "./preview.css";

const navigation = [
  ["产品体验", "product"],
  ["业务协同", "business"],
  ["三端协作", "devices"],
  ["版本更新", "updates"],
] as const;
const deviceInfo = [
  {
    label: "Windows 桌面端",
    icon: Monitor,
    title: "办公室里，业务有条理。",
    text: "从订单处理到财务核对，在熟悉的工作台完成日常业务。支持本地标签打印与自动更新。",
    items: ["采购销售与仓库协同", "本地标签打印", "客户端自动更新"],
  },
  {
    label: "Android PDA",
    icon: Smartphone,
    title: "走到货物面前，就能接着做。",
    text: "把任务带到仓库现场。扫码收货、上架、拣货与出库，按任务指引一步步完成。",
    items: ["扫码识别商品与容器", "按任务执行仓库作业", "设备与仓库绑定"],
  },
  {
    label: "浏览器",
    icon: Globe2,
    title: "打开浏览器，进入工作状态。",
    text: "无需安装客户端，使用已有企业账号登录。业务入口和可见数据依岗位权限开放。",
    items: ["无需安装即可访问", "沿用企业账号与权限", "查看业务进度与记录"],
  },
];

function Brand() {
  return (
    <span className="lp-brand">
      <SystemBrand />
      <span>
        极序 <b>Flow</b>
      </span>
    </span>
  );
}
function scrollToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
}

export default function LandingPreview() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [device, setDevice] = useState(0);
  const [desktop, setDesktop] = useState<{
    version?: string;
    url?: string;
  } | null>(null);
  const [pdaVersion, setPdaVersion] = useState("");
  const [downloadsLoading, setDownloadsLoading] = useState(true);
  const currentDevice = deviceInfo[device];
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
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.getElementById("lp-menu-toggle")?.focus();
      }
    };
    const resize = () => {
      if (window.innerWidth > 800) setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", resize);
    };
  }, [menuOpen]);
  const desktopUrl =
    desktop?.url && /^(https?:\/\/|\/(?!\/))/.test(desktop.url)
      ? desktop.url
      : "";
  function go(id: string) {
    setMenuOpen(false);
    scrollToSection(id);
  }
  return (
    <div className="lp-site">
      <a
        className="lp-skip"
        href="#product"
        onClick={(event) => {
          event.preventDefault();
          go("product");
          document.getElementById("product")?.focus();
        }}
      >
        跳到产品体验
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <button
            className="lp-brand-button"
            aria-label="返回顶部"
            onClick={() => go("home")}
          >
            <Brand />
          </button>
          <nav className="lp-nav" aria-label="主导航">
            {navigation.map(([label, id]) => (
              <button key={id} onClick={() => go(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="lp-header-actions">
            <a href="#/login" className="lp-login">
              进入系统 <ArrowUpRight size={15} />
            </a>
            <button
              className="lp-button lp-small"
              onClick={() => go("downloads")}
            >
              下载客户端
            </button>
            <button
              id="lp-menu-toggle"
              className="lp-menu-toggle"
              aria-label={menuOpen ? "关闭导航" : "打开导航"}
              aria-expanded={menuOpen}
              aria-controls="lp-mobile-nav"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="lp-mobile-nav"
            className="lp-mobile-nav"
            aria-label="手机导航"
          >
            {navigation.map(([label, id]) => (
              <button key={id} onClick={() => go(id)}>
                {label}
                <ArrowUpRight size={16} />
              </button>
            ))}
            <a href="#/login">
              进入系统
              <ArrowUpRight size={16} />
            </a>
          </nav>
        )}
      </header>
      <main>
        <section className="lp-hero" id="home">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-intro">
                <span /> 为有仓库的生意，理顺每一天
              </span>
              <h1>
                业务有序，
                <br />
                经营<span>有数。</span>
              </h1>
              <p>
                从采购到交付，从库存到账款。
                <br />
                让办公室与仓库，在同一个流程里协作。
              </p>
              <div className="lp-hero-actions">
                <a href="#/login" className="lp-button">
                  进入极序 Flow
                  <ArrowUpRight size={18} />
                </a>
                <button
                  className="lp-text-button"
                  onClick={() => go("business")}
                >
                  看看如何协同
                  <ArrowDown size={16} />
                </button>
              </div>
              <div className="lp-hero-platforms">
                <span>
                  <Monitor size={15} />
                  桌面办公
                </span>
                <span>
                  <Smartphone size={15} />
                  PDA 作业
                </span>
                <span>
                  <Globe2 size={15} />
                  浏览器访问
                </span>
              </div>
            </div>
            <div className="lp-hero-product" id="product" tabIndex={-1}>
              <div className="lp-product-backdrop" aria-hidden="true">
                <span>Flow</span>
              </div>
              <ProductDemo />
              <div className="lp-demo-caption">
                <span>
                  <span className="lp-live-dot" />{" "}
                  点击上方场景，看看业务如何衔接
                </span>
                <span>产品结构示意 · 非真实经营数据</span>
              </div>
            </div>
          </div>
          <div className="lp-container lp-hero-bottom">
            <span>让分散的环节，成为连贯的业务。</span>
            <div>
              <span>采购</span>
              <ArrowRight />
              <span>销售</span>
              <ArrowRight />
              <span>仓储</span>
              <ArrowRight />
              <span>财务</span>
              <ArrowRight />
              <span>会计</span>
            </div>
          </div>
        </section>
        <section className="lp-section lp-container" id="business">
          <BusinessStory />
          <div className="lp-capabilities">
            <div>
              <span className="lp-section-label">业务全景</span>
              <h2>
                管好货，
                <br />
                也管好生意。
              </h2>
              <p>
                从补货、交付到对账，
                <br />
                让每个岗位都能找到自己的工作入口。
              </p>
              <a href="#/login" className="lp-text-button">
                进入业务工作台
                <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="lp-capability-list">
              {capabilityGroups.map((item, index) => (
                <details key={item.title} open={index === 0 ? true : undefined}>
                  <summary>
                    <span>{item.title}</span>
                    <ChevronDown size={19} />
                  </summary>
                  <div>
                    <p>{item.description}</p>
                    <a href={item.route}>
                      {item.link}
                      <ArrowUpRight size={15} />
                    </a>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-devices" id="devices">
          <div className="lp-container">
            <div className="lp-devices-heading">
              <h2>
                同一套业务，
                <br />
                在合适的设备上继续。
              </h2>
              <p>
                办公室做决策，仓库按任务执行。
                <br />
                各司其职，也彼此衔接。
              </p>
            </div>
            <div className="lp-device-layout">
              <div className="lp-device-info">
                <div className="lp-device-switch" aria-label="选择客户端">
                  {deviceInfo.map((item, index) => (
                    <button
                      key={item.label}
                      aria-pressed={index === device}
                      onClick={() => setDevice(index)}
                    >
                      <item.icon size={18} />
                      {item.label}
                    </button>
                  ))}
                </div>
                <div aria-live="polite" className="lp-device-description">
                  <h3>{currentDevice.title}</h3>
                  <p>{currentDevice.text}</p>
                  <ul>
                    {currentDevice.items.map((item) => (
                      <li key={item}>
                        <Check size={16} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  className="lp-button lp-white"
                  onClick={() => go("downloads")}
                >
                  选择你的客户端
                  <ArrowRight size={17} />
                </button>
              </div>
              <div
                className="lp-device-art"
                data-device={device}
                aria-label="桌面工作台与 PDA 任务示意"
              >
                <div className="lp-monitor">
                  <div className="lp-monitor-bar">
                    <Brand />
                    <span>我的工作台</span>
                  </div>
                  <div className="lp-monitor-body">
                    <aside>
                      <span className="selected">工作台</span>
                      <span>业务管理</span>
                      <span>仓库作业</span>
                      <span>财务管理</span>
                    </aside>
                    <div>
                      <span className="lp-screen-greeting">
                        每一项工作，都有清楚的下一步。
                      </span>
                      <h4>今天，从待办开始。</h4>
                      <div className="lp-screen-tasks">
                        <span>
                          待处理采购 <b>03</b>
                        </span>
                        <span>
                          待执行任务 <b>08</b>
                        </span>
                      </div>
                      <div className="lp-screen-list">
                        <p>
                          <i />
                          采购收货<span>待处理</span>
                        </p>
                        <p>
                          <i />
                          销售订单复核<span>待处理</span>
                        </p>
                        <p>
                          <i />
                          应收账款核对<span>待处理</span>
                        </p>
                      </div>
                    </div>
                  </div>
                  <span className="lp-screen-demo">示例数据</span>
                </div>
                <div className="lp-phone">
                  <div className="lp-phone-speaker" />
                  <div className="lp-phone-header">
                    <SystemBrand />
                    <b>仓库作业</b>
                  </div>
                  <span className="lp-phone-sub">当前任务 · 拣货</span>
                  <div className="lp-scan">
                    <ScanLine size={58} strokeWidth={1} />
                  </div>
                  <h4>扫描容器条码</h4>
                  <p>按任务指引继续作业</p>
                  <div className="lp-phone-task">
                    <span>缓冲铰链 · 全盖</span>
                    <strong>
                      80 <small>件</small>
                    </strong>
                  </div>
                  <span className="lp-phone-bottom">任务流程示意</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="lp-section lp-container lp-updates" id="updates">
          <div className="lp-section-heading">
            <div>
              <span className="lp-section-label">持续完善，贴近日常</span>
              <h2>每一次更新，都有用。</h2>
            </div>
            <button className="lp-text-button" onClick={() => go("downloads")}>
              获取客户端
              <ArrowDown size={16} />
            </button>
          </div>
          <div className="lp-update-list">
            {landingUpdates.slice(0, 3).map((item, index) => (
              <details key={item.version}>
                <summary>
                  <div className="lp-update-version">
                    <span>v{item.version}</span>
                    {index === 0 && <small>近期更新</small>}
                  </div>
                  <div className="lp-update-title">
                    <span>{item.category}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <span className="lp-update-open">
                    <ChevronDown size={20} />
                  </span>
                </summary>
                <div className="lp-update-detail">
                  <p>{item.description}</p>
                  <ul>
                    {item.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </section>
        <section className="lp-downloads" id="downloads">
          <div className="lp-container">
            <div className="lp-download-heading">
              <Brand />
              <h2>让有序，成为日常。</h2>
              <p>选择合适的入口，开始今天的工作。</p>
            </div>
            <div className="lp-download-options">
              <article>
                <Monitor size={26} strokeWidth={1.5} />
                <h3>Windows 桌面端</h3>
                <p>日常办公、本地打印与自动更新。</p>
                <small>
                  {desktop?.version
                    ? `安装包版本 v${desktop.version}`
                    : "版本信息以发布清单为准"}
                </small>
                {desktopUrl ? (
                  <a className="lp-button" href={desktopUrl}>
                    <Download size={16} />
                    下载 Windows 版
                  </a>
                ) : (
                  <button className="lp-button" disabled>
                    {downloadsLoading ? "正在获取安装包…" : "暂未获取到安装包"}
                  </button>
                )}
              </article>
              <article>
                <Smartphone size={26} strokeWidth={1.5} />
                <h3>Android PDA 端</h3>
                <p>用于仓库现场的手持扫码作业。</p>
                <small>
                  {pdaVersion
                    ? `安装包版本 v${pdaVersion}`
                    : "适用于 Android 手持设备"}
                </small>
                <a className="lp-button lp-outline" href="/api/pda/download">
                  <Download size={16} />
                  下载 PDA 版
                </a>
              </article>
              <article>
                <Globe2 size={26} strokeWidth={1.5} />
                <h3>浏览器直接使用</h3>
                <p>无需安装，登录企业业务工作台。</p>
                <small>使用已有企业账号登录</small>
                <a className="lp-button lp-outline" href="#/login">
                  进入网页版
                  <ArrowUpRight size={16} />
                </a>
              </article>
            </div>
            <div className="lp-download-footnote">
              <ShieldCheck size={16} />
              业务入口遵循企业账号权限，PDA 作业需绑定设备与仓库。
            </div>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-top">
            <div>
              <Brand />
              <p>业务有序，经营有数。</p>
            </div>
            <nav aria-label="页脚导航">
              {navigation.map(([label, id]) => (
                <button key={id} onClick={() => go(id)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="lp-contact">
              <span>聊聊你的业务与使用需求</span>
              <a href="tel:15701178441">
                <Phone size={16} />
                157 0117 8441
                <ArrowUpRight size={15} />
              </a>
              <a href="mailto:15701178441@139.com">
                <Mail size={16} />
                15701178441@139.com
              </a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} 极序 Flow</span>
            <span>ERP / WMS 企业管理系统</span>
            <button onClick={() => go("home")}>返回顶部 ↑</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
