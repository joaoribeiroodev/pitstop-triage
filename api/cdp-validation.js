/** Valida estrutura mínima do CDP antes de devolver ao frontend. */
export function isDiagnosticoCdpValid(value) {
    if (!value || typeof value !== 'object')
        return false;
    const d = value;
    return (typeof d['resumo_para_cliente'] === 'string' &&
        Boolean(d['resumo_para_cliente'].trim()) &&
        typeof d['risco_principal'] === 'string' &&
        Array.isArray(d['hipoteses']) &&
        d['hipoteses'].length > 0 &&
        Array.isArray(d['acoes_imediatas']) &&
        d['acoes_imediatas'].length > 0);
}
export function buildRespostasDetalhadas(respostas, perguntas) {
    if (!respostas)
        return [];
    return Object.entries(respostas).map(([id, resposta]) => ({
        id,
        pergunta: perguntas?.[id]?.trim() || id,
        resposta
    }));
}
const TERMOS_EMBREAGEM_PEDAL = [
    'cilindro mestre da embreagem',
    'cilindro mestre de embreagem',
    'cilindro escravo da embreagem',
    'cilindro escravo de embreagem',
    'platô de embreagem',
    'plato de embreagem',
    'disco de embreagem',
    'kit de embreagem',
    'pedal de embreagem'
];
const TERMOS_CVT = [
    'cvt',
    'transmissão continuamente variável',
    'transmissao continuamente variavel',
    'corrente cvt',
    'polia variável',
    'polia variavel',
    'variator',
    'continuously variable'
];
function normalizarTexto(texto) {
    return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
function textoContemTermo(texto, termos) {
    const norm = normalizarTexto(texto);
    return termos.some((termo) => norm.includes(normalizarTexto(termo)));
}
function coletarTextosHipotese(hipotese) {
    const partes = [];
    for (const key of ['titulo', 'justificativa_tecnica', 'sistema_afetado']) {
        const val = hipotese[key];
        if (typeof val === 'string')
            partes.push(val);
    }
    const componentes = hipotese['componentes_a_verificar'];
    if (Array.isArray(componentes)) {
        for (const comp of componentes) {
            if (comp && typeof comp === 'object' && typeof comp['nome'] === 'string') {
                partes.push(comp['nome']);
            }
        }
    }
    return partes;
}
function hipoteseIncompativelComTransmissao(hipotese, tipo) {
    const texto = coletarTextosHipotese(hipotese).join(' ');
    if (tipo === 'automatico_conversor' && textoContemTermo(texto, TERMOS_EMBREAGEM_PEDAL)) {
        return true;
    }
    if (tipo !== 'cvt' && textoContemTermo(texto, TERMOS_CVT)) {
        return true;
    }
    return false;
}
/** Remove hipóteses incompatíveis com o tipo de transmissão informado. */
export function sanitizarCdpPorTransmissao(cdp, tipoTransmissao) {
    const tipo = (tipoTransmissao ?? 'desconhecido');
    if (tipo === 'desconhecido' || tipo === 'manual' || tipo === 'automatico_embreagem') {
        return { cdp, rejeitado: false };
    }
    const hipotesesRaw = cdp['hipoteses'];
    if (!Array.isArray(hipotesesRaw))
        return { cdp, rejeitado: false };
    const removidas = [];
    const hipotesesFiltradas = hipotesesRaw.filter((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const h = item;
        if (hipoteseIncompativelComTransmissao(h, tipo)) {
            removidas.push(typeof h['titulo'] === 'string' ? h['titulo'] : '(sem título)');
            return false;
        }
        return true;
    });
    if (removidas.length > 0) {
        console.warn(`[cdp-validation] Hipóteses removidas por incompatibilidade com transmissão "${tipo}":`, removidas);
    }
    if (hipotesesFiltradas.length === 0) {
        return {
            cdp,
            rejeitado: true,
            motivo: `Todas as hipóteses eram incompatíveis com transmissão "${tipo}"`
        };
    }
    return {
        cdp: { ...cdp, hipoteses: hipotesesFiltradas },
        rejeitado: false
    };
}
export function buildInstrucaoTransmissao(veiculo) {
    const tipo = veiculo?.['tipoTransmissao'] ?? 'desconhecido';
    const origem = veiculo?.['tipoTransmissaoOrigem'] ?? 'nao_informada';
    return `
RESTRICOES DE TRANSMISSAO:
O veiculo tem tipo de transmissao: ${tipo} (origem: ${origem}).
- NAO gere hipoteses nem itens de verificacao citando componentes de embreagem com pedal (disco, plato, cilindro mestre/escravo, kit de embreagem) se o tipo for "automatico_conversor".
- NAO gere hipotese de CVT (corrente CVT, polias variaveis, transmissao continuamente variavel) se o tipo NAO for "cvt".
- Se tipoTransmissaoOrigem for "inferido", trate como provavel mas nao confirmado.
- Se tipoTransmissao for "desconhecido", voce pode considerar multiplas possibilidades, mas inclua nas acoes_imediatas a recomendacao de confirmar o tipo de cambio na oficina.
`.trim();
}
