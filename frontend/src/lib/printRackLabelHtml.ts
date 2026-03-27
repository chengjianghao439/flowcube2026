/**
 * 货架标签：走与销售单相同的「HTML → iframe.print() → 系统打印对话框」路径。
 *
 * 与 ZPL 本机 RAW 的区别：
 * - 不发送 ZPL、不经 WinSpool/CUPS raw，普通办公打印机也可印（分辨率/版式按 A4 等由驱动决定）。
 * - 不调打印队列入库接口，不创建/核销 print-jobs。
 */
import JsBarcode from 'jsbarcode'
import { escapeHtmlText, printHtmlDocument } from '@/lib/printHtmlDocument'
import type { Rack } from '@/types/racks'

export function printRackLabelWithSystemDialog(
  rack: Rack,
): { ok: true } | { ok: false; reason: string } {
  const bc = rack.barcode?.trim()
  if (!bc) return { ok: false, reason: '该货架暂无条码，无法打印' }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, bc, {
      format: 'CODE128',
      width: 2,
      height: 64,
      fontSize: 12,
      margin: 4,
      displayValue: true,
    })
  } catch {
    return { ok: false, reason: '条码图形生成失败' }
  }

  const title = escapeHtmlText(`货架标签 ${bc}`)
  const code = escapeHtmlText(rack.code)
  const zone = escapeHtmlText(rack.zone || '—')
  const name = escapeHtmlText(rack.name || '—')
  const wh = escapeHtmlText(rack.warehouseName || '—')
  const svgHtml = svg.outerHTML

  printHtmlDocument(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title><style>
    body{font-family:'PingFang SC',Microsoft YaHei,sans-serif;margin:0;padding:16px;color:#000}
    .label{display:inline-block;border:1px solid #333;padding:14px 18px;min-width:240px;text-align:center}
    .muted{font-size:11px;color:#555;margin-top:6px}
    .line{font-size:13px;margin-top:4px}
    @media print{body{padding:8px}}
  </style></head><body>
    <div class="label">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">货架标签</div>
      ${svgHtml}
      <div class="line"><strong>${code}</strong></div>
      <div class="muted">库区 ${zone} · ${name}</div>
      <div class="muted">仓库 ${wh}</div>
    </div>
  </body></html>`)

  return { ok: true }
}
