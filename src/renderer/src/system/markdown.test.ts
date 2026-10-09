import { describe, expect, it } from 'vitest'
import { escapeHtml, renderInline, renderMarkdown } from './markdown'

describe('markdown renderer', () => {
  it('escapes raw HTML everywhere', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n# <img src=x onerror=alert(1)>\n\n- <b>x</b>\n\n```\n<div>\n```')
    expect(html).not.toMatch(/<script|<img|<b>|<div>/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<h1>&lt;img src=x onerror=alert(1)&gt;</h1>')
    expect(html).toContain('<pre><code>&lt;div&gt;</code></pre>')
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;')
  })

  it('only links http(s)/mailto and cannot break out of attributes', () => {
    expect(renderInline('[x](javascript:alert)')).toBe('x')
    expect(renderInline('[x](javascript:alert(1))')).not.toContain('<a')
    expect(renderInline('[x](data:text/html,hi)')).toBe('x')
    const ok = renderInline('[site](https://a.b/c?d=1&e=2)')
    expect(ok).toBe('<a href="https://a.b/c?d=1&amp;e=2" target="_blank" rel="noopener noreferrer">site</a>')
    const evil = renderInline('[x](https://a.b/"onmouseover="alert(1))')
    expect(evil).not.toMatch(/"onmouseover/)
    expect(renderInline('see https://github.com/x/y_z_w.')).toBe('see <a href="https://github.com/x/y_z_w" target="_blank" rel="noopener noreferrer">https://github.com/x/y_z_w</a>.')
  })

  it('renders headings, lists, code, emphasis and quotes', () => {
    const html = renderMarkdown(
      [
        '## What’s new',
        'Some **bold** and *italic* text with `a<b>` code.',
        'second line',
        '',
        '- one',
        '- two `x`',
        '  continued',
        '1. first',
        '2. second',
        '',
        '> note',
        '---',
        '### Fixes'
      ].join('\n')
    )
    expect(html).toBe(
      [
        '<h2>What’s new</h2>',
        '<p>Some <strong>bold</strong> and <em>italic</em> text with <code>a&lt;b&gt;</code> code.<br>second line</p>',
        '<ul><li>one</li><li>two <code>x</code> continued</li></ul>',
        '<ol><li>first</li><li>second</li></ol>',
        '<blockquote>note</blockquote>',
        '<hr>',
        '<h3>Fixes</h3>'
      ].join('\n')
    )
  })

  it('does not format inside code spans and strips NULs', () => {
    expect(renderInline('`**not bold**`')).toBe('<code>**not bold**</code>')
    expect(renderInline('a\u00000\u0000b')).toBe('a0b')
  })
})
