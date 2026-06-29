import type { VercelRequest, VercelResponse } from '@vercel/node';

export const GEMINI_MODEL = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Privacy-Policy', 'Dados processados apenas para triagem; sem persistência em banco.');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function requirePost(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Metodo nao permitido' });
    return false;
  }
  return true;
}

export function requireApiKey(res: VercelResponse): string | null {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY nao configurada no ambiente' });
    return null;
  }
  return apiKey;
}

export function safeParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface TriagemBody {
  veiculo?: { marca?: string; modelo?: string; ano?: string };
  zonaSelecionada?: string;
  sintomas?: unknown;
}

export function isTriagemValida(body: unknown): body is TriagemBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as TriagemBody;
  return Boolean(
    b.veiculo?.marca?.trim() &&
    b.veiculo?.modelo?.trim() &&
    b.veiculo?.ano?.trim() &&
    b.zonaSelecionada?.trim() &&
    Array.isArray(b.sintomas) &&
    b.sintomas.length > 0
  );
}
