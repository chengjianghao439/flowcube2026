import { useState } from "react";
import {
  ArrowRight,
  Check,
  PackageCheck,
  ScanLine,
  ShoppingCart,
} from "lucide-react";

const steps = [
  {
    name: "销售占库",
    icon: ShoppingCart,
    title: "接下订单，也看清供应。",
    description:
      "80 件订单，40 件现货，40 件依赖采购到货。销售知道能承诺什么，采购知道要补齐什么。",
    stock: 40,
    expected: 40,
    status: "等待采购到货",
    note: "预计供应可用于占库；实物到位才能出库。",
  },
  {
    name: "收货待上架",
    icon: ScanLine,
    title: "货到了，按步骤接进来。",
    description:
      "PDA 扫码收货，记录容器与来源。新到的 40 件仍需上架，收货完成不等于已经可以发走。",
    stock: 40,
    expected: 40,
    status: "等待上架完成",
    note: "待上架的货物，仍未计入可出库实物。",
  },
  {
    name: "上架完成",
    icon: PackageCheck,
    title: "实物到位，继续履约。",
    description:
      "采购供应完成兑现，80 件订单都有实物支撑。仓库按任务继续拣货、复核和出库。",
    stock: 80,
    expected: 0,
    status: "已有实物支撑",
    note: "上架兑现预计供应，不重复增加销售预占。",
  },
];
export default function BusinessStory() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  return (
    <div className="lp-story">
      <div className="lp-story-copy">
        <span className="lp-section-label">从一张订单开始</span>
        <h2>
          每一步业务，
          <br />
          都有下一步。
        </h2>
        <p>
          销售的承诺，采购接得住；
          <br />
          仓库的动作，账上看得清。
        </p>
        <div className="lp-story-steps" aria-label="查看供货阶段">
          {steps.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                aria-pressed={index === active}
                onClick={() => setActive(index)}
              >
                <span>{index + 1}</span>
                <Icon size={19} />
                {item.name}
                <ArrowRight size={17} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="lp-story-visual" aria-live="polite">
        <div className="lp-order-title">
          <span>销售订单 / 供货跟踪</span>
          <span className="lp-demo-label">流程示意</span>
        </div>
        <div className="lp-order-product">
          <div className="lp-parcel" aria-hidden="true">
            <PackageCheck size={38} strokeWidth={1.3} />
          </div>
          <div>
            <span>缓冲铰链 · 全盖</span>
            <strong>
              80 <small>件</small>
            </strong>
          </div>
          <span className="lp-status">{step.status}</span>
        </div>
        <div className="lp-supply-labels">
          <span>
            实物支撑 <b>{step.stock} 件</b>
          </span>
          <span>
            待兑现采购 <b>{step.expected} 件</b>
          </span>
        </div>
        <div
          className="lp-supply-bar"
          role="img"
          aria-label={`实物支撑 ${step.stock} 件，待兑现采购 ${step.expected} 件`}
        >
          <span style={{ width: `${(step.stock / 80) * 100}%` }} />
          <span style={{ width: `${(step.expected / 80) * 100}%` }} />
        </div>
        <div className="lp-story-explanation" key={active}>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
          <div>
            <Check size={16} />
            {step.note}
          </div>
        </div>
        <p className="lp-example-note">固定示例：假设期间没有其他库存变动。</p>
      </div>
    </div>
  );
}
