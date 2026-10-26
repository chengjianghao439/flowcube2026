import { Fragment } from 'react'

// 只呈现强调和文字列表；模型返回的 HTML、链接与脚本始终保留为普通文本。
function inline(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)
}
export default function MessageText({ text }: { text: string }) {
  return <>{text.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n')
    if (lines.every(line => /^\d+[.)]\s+/.test(line))) return <ol key={index} start={Number(lines[0].match(/^\d+/)?.[0]) || 1}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\d+[.)]\s+/, ''))}</li>)}</ol>
    if (lines.every(line => /^[-*•]\s+/.test(line))) return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^[-*•]\s+/, ''))}</li>)}</ul>
    return <p key={index}>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{inline(line)}</Fragment>)}</p>
  })}</>
}
