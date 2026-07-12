export const OPENAI_MODEL = process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini';
export function applyCors(req, res) {
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
export function requirePost(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Metodo nao permitido' });
        return false;
    }
    return true;
}
export function requireApiKey(res) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
        res.status(500).json({ error: 'OPENAI_API_KEY nao configurada no ambiente' });
        return null;
    }
    return apiKey;
}
export function safeParse(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
export function isTriagemValida(body) {
    if (!body || typeof body !== 'object')
        return false;
    const b = body;
    return Boolean(b.veiculo?.marca?.trim() &&
        b.veiculo?.modelo?.trim() &&
        b.veiculo?.ano?.trim() &&
        b.zonaSelecionada?.trim() &&
        Array.isArray(b.sintomas) &&
        b.sintomas.length > 0);
}
