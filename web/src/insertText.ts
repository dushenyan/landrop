export function insertAtCursor(
  el: HTMLTextAreaElement | null,
  snippet: string,
  onChange: (value: string) => void
): void {
  if (!el) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  onChange(value.slice(0, start) + snippet + value.slice(end));
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = start + snippet.length;
    el.selectionEnd = start + snippet.length;
  });
}
