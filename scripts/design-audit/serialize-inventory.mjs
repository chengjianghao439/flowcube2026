/** Keep each inventory record on one line, without dropping fields or evidence.
 * The companion Markdown is the human-readable review; JSON remains lossless. */
export function serializeInventory(data) {
  return '{\n' + Object.entries(data).map(([key, value]) => {
    const prefix = '  ' + JSON.stringify(key) + ': '
    if (!Array.isArray(value) || value.length === 0) return prefix + JSON.stringify(value)
    return prefix + '[\n' + value.map(record => '    ' + JSON.stringify(record)).join(',\n') + '\n  ]'
  }).join(',\n') + '\n}\n'
}
