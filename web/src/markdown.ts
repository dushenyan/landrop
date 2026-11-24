const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function safeUrl(url: string): string {
  const value = url.trim();
  if (!/^(https?:\/\/|\/)/i.test(value)) return '#';
  return value.replace(/"/g, '%22').replace(/'/g, '%27');
}

function inline(src: string): string {
  return src
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) =>
      `<img src="${safeUrl(url)}" alt="${alt}">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string, url: string) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`);
}

export function renderDocument(src: string): string {
  const lines = src.replace(/[&<>"']/g, (ch) => ESCAPES[ch]).split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      out.push(inCode ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    if (!line.trim()) continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) out.push('</code></pre>');
  return out.join('');
}

export function plainText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
