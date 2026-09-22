// 轴宽 112px、字号 12px；每行最多 8 个字符，为全角名称及连续编码保留空间。
const CHARACTERS_PER_LINE = 8
export const LINE_HEIGHT = 16

export function splitChartLabel(value: string): string[] {
  return value.split('\n').flatMap(part => {
    const characters = Array.from(part)
    if (!characters.length) return ['']
    const lines: string[] = []
    for (let i = 0; i < characters.length; i += CHARACTERS_PER_LINE) {
      lines.push(characters.slice(i, i + CHARACTERS_PER_LINE).join(''))
    }
    return lines
  })
}

export function categoryChartHeight(names: string[]): number {
  const lineCount = names.reduce((max, name) => Math.max(max, splitChartLabel(name).length), 1)
  return Math.max(240, names.length * (lineCount * LINE_HEIGHT + 20) + 40)
}
