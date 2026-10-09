// Tiny, safe markdown → HTML renderer for GitHub release notes. Everything is HTML-escaped first; only a
// fixed set of tags is produced (h1-h4, p, ul/ol/li, pre/code, blockquote, hr, strong, em, del, a).
// Links are limited to http(s)/mailto and open externally (target=_blank → shell.openExternal in main).

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i
const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`

/** Inline formatting on raw text (escapes it). */
export function renderInline(raw: string): string {
  const codes: string[] = []
  // Code spans first, so nothing inside them is formatted.
  let s = raw.replace(/\u0000/g, '').replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = escapeHtml(s)
  // [text](url)
  const stash = (html: string) => {
    codes.push(html)
    return `\u0000${codes.length - 1}\u0000`
  }
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (m, text: string, url: string) => (SAFE_URL.test(url) ? stash(link(url, text)) : text))
  // bare URLs
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre: string, url: string) => {
    const trail = /[.,;:!?)]+$/.exec(url)?.[0] ?? ''
    const u = trail ? url.slice(0, -trail.length) : url
    return `${pre}${stash(link(u, u))}${trail}`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  for (let n = 0; n < 3 && s.includes('\u0000'); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)])
  return s
}

/** Block-level markdown → HTML string. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`)
    para = []
  }
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${list.type}>`)
    list = null
  }
  const flush = () => {
    flushPara()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i])
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      const lvl = Math.min(4, h[1].length)
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`)
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const type = ul ? 'ul' : 'ol'
      if (list && list.type !== type) flushList()
      if (!list) list = { type, items: [] }
      list.items.push((ul ?? ol)![1].replace(/^\[([ xX])\]\s+/, (_, c: string) => (c === ' ' ? '☐ ' : '☑ ')))
      continue
    }
    const bq = /^\s*>\s?(.*)$/.exec(line)
    if (bq) {
      flush()
      const body = [bq[1]]
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${body.map(renderInline).join('<br>')}</blockquote>`)
      continue
    }
    // continuation of a list item (indented text)
    if (list && /^\s{2,}\S/.test(line)) {
      const items: string[] = (list as { items: string[] }).items
      items[items.length - 1] += ` ${line.trim()}`
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flush()
  return out.join('\n')
}
