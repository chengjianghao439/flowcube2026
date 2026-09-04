import { useState } from "react";
import { ArrowRight, Check, Package, ScanLine } from "lucide-react";

const stages = [
  {
    label: "销售占库",
    title: "80 件订单，40 件现货，40 件等采购。",
    text: "现货不足时，销售占用可以关联尚未上架的采购供应。订单依赖哪笔采购，系统保留记录。",
    physical: "40 件",
    expected: "40 件",
    note: "本单已占量为 80 件；其中 40 件仍依赖采购。",
  },
  {
    label: "采购收货",
    title: "货已收到，上架之前仍要继续等待。",
    text: "收货扫码创建待上架容器，再扫描库位完成上架。到货与实物可用是两个环节，不能提前当作可出库库存。",
    physical: "40 件",
    expected: "40 件",
    note: "新收 40 件正在待上架；本单已占量不变。",
  },
  {
    label: "上架完成",
    title: "采购供应兑现，订单有了实物支撑。",
    text: "关联的采购数量上架后，预计供应转为实物支撑。仓库仍需完成拣货、分拣、复核、打包等作业，才能出库。",
    physical: "80 件",
    expected: "0 件",
    note: "本单占用的 80 件已有实物供应，不会再重复占一次。",
  },
];

export default function SupplyStory() {
  const [stage, setStage] = useState(0);
  const current = stages[stage];
  return (
    <div className="flow-supply-story">
      <div className="flow-supply-copy">
        <p className="flow-section-kicker">把“有货”和“有承诺”分清楚</p>
        <h3>
          客户要的货，
          <br />
          还在采购路上怎么办？
        </h3>
        <p>用一张 80 件的订单，看销售、采购和仓库如何衔接。</p>
        <div className="flow-supply-steps" aria-label="供货过程示意">
          {stages.map((item, index) => (
            <button
              key={item.label}
              aria-pressed={stage === index}
              onClick={() => setStage(index)}
            >
              <span>{index === 2 ? <Check size={14} /> : index + 1}</span>
              {item.label}
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
        <small>
          简化示例：假设相关采购正常履行、无其他库存变动。不是实时库存或发货承诺。
        </small>
      </div>
      <div className="flow-supply-board" aria-live="polite">
        <div className="flow-supply-board-top">
          <span>
            <Package size={17} /> 缓冲铰链 · 示例订单
          </span>
          <span>80 件</span>
        </div>
        <div className="flow-supply-stage" key={stage}>
          <h4>{current.title}</h4>
          <p>{current.text}</p>
        </div>
        <div
          className="flow-supply-bars"
          aria-label={`本单实物支撑${current.physical}，待兑现采购${current.expected}`}
        >
          <span className={stage === 2 ? "is-fulfilled" : ""} />
          <span />
        </div>
        <div className="flow-supply-legend">
          <span>
            <i />
            本单实物支撑 <b>{current.physical}</b>
          </span>
          <span>
            <i />
            待兑现采购 <b>{current.expected}</b>
          </span>
        </div>
        <p className="flow-supply-note">
          <ScanLine size={17} />
          {current.note}
        </p>
      </div>
    </div>
  );
}
