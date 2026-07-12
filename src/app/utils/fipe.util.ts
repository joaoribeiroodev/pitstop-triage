export function formatarAnoFipe(value: string | number | null | undefined): string {
  const texto = typeof value === 'number' ? String(value) : (value ?? '').trim();
  if (!texto) return '';

  const match = texto.match(/^32000(?:\s*[-/–]?\s*(.+))?$/i);
  if (!match) return texto;

  const restante = (match[1] ?? '').trim().replace(/^[-/–\s]+|[-/–\s]+$/g, '');
  return restante ? `0 Km ${restante}` : '0 Km';
}
