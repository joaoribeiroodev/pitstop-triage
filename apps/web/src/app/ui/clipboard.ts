/** Copia para a área de transferência; em navegadores sem permissão, cai num prompt para copiar à mão. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt('Copie o texto:', text);
    return false;
  }
}
