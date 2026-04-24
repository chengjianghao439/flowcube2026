function buildContainerLabelKind(containerCode) {
  const code = String(containerCode ?? '').toUpperCase()
  if (code.startsWith('B')) return '塑料盒'
  return '库存'
}

function buildContainerLabelZpl({ container_code, product_name, qty }) {
  const code = String(container_code ?? '').replace(/[\r\n^~]/g, '')
  const name = String(product_name ?? '')
    .slice(0, 32)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
  const q = Number(qty)
  const qtyStr = Number.isFinite(q) ? String(q) : String(qty ?? '')
  const kind = buildContainerLabelKind(container_code)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,24,24^FD${name}^FS^FO32,148^A0N,24,24^FD${kind}^FS^FO32,184^A0N,24,24^FDQTY ${qtyStr}^FS^XZ`
}

function buildRackLabelZpl({ rack_barcode, rack_code, zone, name }) {
  const code = String(rack_barcode ?? '').replace(/[\r\n^~]/g, '')
  const rc = String(rack_code ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 28)
  const z = String(zone ?? '').slice(0, 12)
  const n = String(name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${rc}^FS^FO32,138^A0N,20,20^FD${z} ${n}^FS^XZ`
}

function buildPackageLabelZpl({ box_code, task_no, customer_name, summary }) {
  const bc = String(box_code ?? '').replace(/[\r\n^~]/g, '')
  const tn = String(task_no ?? '').slice(0, 24)
  const cn = String(customer_name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 24)
  const sm = String(summary ?? '').slice(0, 36)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${bc}^FS^FO32,108^A0N,22,22^FD${tn}^FS^FO32,142^A0N,20,20^FD${cn}^FS^FO32,176^A0N,18,18^FD${sm}^FS^XZ`
}

function buildProductLabelZpl({ product_code, product_name, spec, unit, price }) {
  const code = String(product_code ?? '').replace(/[\r\n^~]/g, '')
  const name = String(product_name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 24)
  const sp = String(spec ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  const meta = [unit ? `/${unit}` : '', price ? `¥${price}` : ''].join(' ').trim()
  const metaSafe = meta.replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?').slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${name}^FS${sp ? `^FO32,142^A0N,20,20^FD${sp}^FS` : ''}${metaSafe ? `^FO32,176^A0N,18,18^FD${metaSafe}^FS` : ''}^XZ`
}

module.exports = {
  buildContainerLabelKind,
  buildContainerLabelZpl,
  buildRackLabelZpl,
  buildPackageLabelZpl,
  buildProductLabelZpl,
}
