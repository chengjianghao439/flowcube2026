const { sanitizeZplValue } = require('./labelZpl')

function buildContainerLabelKind(containerCode) {
  const code = String(containerCode ?? '').toUpperCase()
  if (code.startsWith('B')) return '塑料盒'
  return '库存'
}

function buildContainerLabelZpl({ container_code, product_name, qty }) {
  const code = sanitizeZplValue(String(container_code ?? '').replace(/[\r\n^~]/g, ''), { trim: false })
  const name = sanitizeZplValue(product_name)
    .slice(0, 32)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
  const q = Number(qty)
  const qtyStr = Number.isFinite(q) ? String(q) : sanitizeZplValue(qty)
  const kind = buildContainerLabelKind(container_code)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,24,24^FD${name}^FS^FO32,148^A0N,24,24^FD${kind}^FS^FO32,184^A0N,24,24^FDQTY ${qtyStr}^FS^XZ`
}

function buildRackLabelZpl({ rack_barcode, rack_code, zone, name }) {
  const code = sanitizeZplValue(String(rack_barcode ?? '').replace(/[\r\n^~]/g, ''), { trim: false })
  const rc = sanitizeZplValue(rack_code)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 28)
  const z = sanitizeZplValue(zone).slice(0, 12)
  const n = sanitizeZplValue(name)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${rc}^FS^FO32,138^A0N,20,20^FD${z} ${n}^FS^XZ`
}

/** \u5e93\u4f4d\u6807\u7b7e\uff08warehouse_locations\uff0c\u6761\u7801 R+\u6570\u5b57\uff09\uff1a\u6761\u7801 + \u5e93\u4f4d\u7f16\u7801 + \u533a\u57df/\u540d\u79f0 */
function buildLocationLabelZpl({ location_barcode, location_code, zone, name }) {
  const code = sanitizeZplValue(String(location_barcode ?? '').replace(/[\r\n^~]/g, ''), { trim: false })
  const lc = sanitizeZplValue(location_code)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 28)
  const z = sanitizeZplValue(zone).slice(0, 12)
  const n = sanitizeZplValue(name)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${lc}^FS^FO32,138^A0N,20,20^FD${z} ${n}^FS^XZ`
}

function buildPackageLabelZpl({ box_code, task_no, customer_name, carrier_name, freight_type_name, piece_count, item_list, summary }) {
  const bc = sanitizeZplValue(String(box_code ?? '').replace(/[\r\n^~]/g, ''), { trim: false })
  const tn = sanitizeZplValue(task_no).slice(0, 20)
  const cn = sanitizeZplValue(customer_name)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 16)
  const ca = sanitizeZplValue(carrier_name).slice(0, 12)
  const ft = sanitizeZplValue(freight_type_name).slice(0, 8)
  const pc = sanitizeZplValue(piece_count).slice(0, 10)
  const il = sanitizeZplValue(item_list).slice(0, 60)
  const sm = sanitizeZplValue(summary).slice(0, 24)
  const carrierFreight = [ca, ft].filter(Boolean).join(' ')
  return `^XA^CI28^LH0,0^FO32,20^BY2^BCN,60,Y,N,N^FD${bc}^FS^FO32,90^A0N,22,22^FD${tn}^FS^FO32,118^A0N,20,20^FD${cn}^FS^FO32,142^A0N,18,18^FD${carrierFreight}^FS^FO32,164^A0N,18,18^FD${pc} ${sm}^FS^FO32,186^A0N,16,16^FD${il}^FS^XZ`
}

function buildPlasticBoxLabelZpl({ container_code, product_name }) {
  const code = sanitizeZplValue(String(container_code ?? '').replace(/[\r\n^~]/g, ''), { trim: false })
  const name = sanitizeZplValue(product_name)
    .slice(0, 32)
    .replace(/[^\x20-\x7E一-鿿]/g, '?')
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,24,24^FD${name}^FS^FO32,148^A0N,24,24^FD塑料盒^FS^XZ`
}

function buildProductLabelZpl({ product_code, product_name, spec, unit, price }) {
  const code = sanitizeZplValue(String(product_code ?? '').replace(/[\r\n^~]/g, ''), { trim: false })
  const name = sanitizeZplValue(product_name)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 24)
  const sp = sanitizeZplValue(spec)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  const meta = [unit ? `/${sanitizeZplValue(unit)}` : '', price ? `¥${sanitizeZplValue(price)}` : ''].join(' ').trim()
  const metaSafe = meta.replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?').slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${name}^FS${sp ? `^FO32,142^A0N,20,20^FD${sp}^FS` : ''}${metaSafe ? `^FO32,176^A0N,18,18^FD${metaSafe}^FS` : ''}^XZ`
}

module.exports = {
  buildContainerLabelKind,
  buildContainerLabelZpl,
  buildPlasticBoxLabelZpl,
  buildRackLabelZpl,
  buildLocationLabelZpl,
  buildPackageLabelZpl,
  buildProductLabelZpl,
}
