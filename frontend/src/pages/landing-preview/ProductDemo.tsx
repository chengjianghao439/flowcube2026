import { useState, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardList,
  Package,
  ReceiptText,
  RotateCcw,
  ShoppingCart,
  Warehouse,
} from "lucide-react";
import SystemBrand from "@/components/shared/SystemBrand";
import { productScenes } from "../landing/product-content";

const icons = [ShoppingCart, ClipboardList, Warehouse, RotateCcw, ReceiptText];

export default function ProductDemo() {
  const [active, setActive] = useState(1);
  const scene = productScenes[active];
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % productScenes.length;
    else if (event.key === "ArrowLeft")
      next = (index + productScenes.length - 1) % productScenes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = productScenes.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    document.getElementById(`preview-scene-${next}`)?.focus();
  }
  return (
    <div className="lp-product" aria-label="极序 Flow 产品交互示意">
      <div className="lp-product-top">
        <span>
          <SystemBrand /> 极序 Flow <i /> 业务工作台
        </span>
        <span className="lp-demo-label">示例数据</span>
      </div>
      <div className="lp-product-tabs" role="tablist" aria-label="业务场景">
        {productScenes.map((item, index) => {
          const Icon = icons[index];
          return (
            <button
              key={item.name}
              id={`preview-scene-${index}`}
              role="tab"
              aria-selected={active === index}
              aria-controls="preview-scene-panel"
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => move(event, index)}
            >
              <Icon size={15} />
              {item.name}
            </button>
          );
        })}
      </div>
      <div
        id="preview-scene-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`preview-scene-${active}`}
        className="lp-product-content"
      >
        <div className="lp-product-heading">
          <div>
            <span className="lp-breadcrumb">
              业务管理 <ChevronRight size={12} /> {scene.name}
            </span>
            <h2>{scene.title}</h2>
          </div>
          <span className="lp-product-symbol">
            <Package size={25} strokeWidth={1.4} />
          </span>
        </div>
        <p className="lp-product-description">{scene.description}</p>
        <div className="lp-table-scroll">
          <table>
            <caption className="lp-sr">{scene.name}示例数据</caption>
            <thead>
              <tr>
                {scene.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scene.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, index) => (
                    <td key={index}>
                      {index === row.length - 1 ? (
                        <span className="lp-status">{value}</span>
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
        <div className="lp-product-note">
          <Check size={15} />
          <span>{scene.label}</span>
        </div>
        <div className="lp-product-footer">
          <span>{scene.note}</span>
          <a href={scene.route} aria-label={`进入系统查看${scene.name}`}>
            <ArrowUpRight size={17} />
          </a>
        </div>
      </div>
      <div className="lp-product-bottom">
        <span>
          <i /> 订单 · 库存 · 账款，清晰衔接
        </span>
        <span>ERP + WMS</span>
      </div>
    </div>
  );
}
