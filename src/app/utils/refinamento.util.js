function extrairOpcoes(raw) {
    const candidato = raw['opcoes'] ?? raw['alternativas'] ?? raw['options'];
    if (Array.isArray(candidato)) {
        return candidato.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof candidato === 'string' && candidato.trim()) {
        return candidato
            .split(/[,;|]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}
export function normalizarTipoPergunta(tipo) {
    const valor = String(tipo ?? '')
        .toLowerCase()
        .replace(/[\s-]/g, '_');
    if (valor === 'sim_nao' || valor === 'simnao' || valor === 'boolean')
        return 'sim_nao';
    if (valor === 'escala' || valor === 'scale')
        return 'escala';
    return 'multipla_escolha';
}
function opcoesPadrao(tipo) {
    if (tipo === 'sim_nao')
        return ['Sim', 'Não'];
    if (tipo === 'escala')
        return ['Raramente', 'Às vezes', 'Frequentemente', 'Sempre'];
    return ['Sim', 'Não', 'Às vezes', 'Não sei'];
}
/** Garante estrutura completa para renderizar botões de resposta na UI. */
export function normalizarPerguntaRefinamento(raw, rodadaPadrao = 1) {
    const id = String(raw.id ?? '').trim();
    const pergunta = String(raw.pergunta ?? '').trim();
    if (!id || !pergunta)
        return null;
    const tipo = normalizarTipoPergunta(raw.tipo);
    let opcoes = extrairOpcoes(raw);
    if (opcoes.length === 0) {
        opcoes = opcoesPadrao(tipo);
    }
    const objetivo = String(raw.objetivo ?? '').trim() || 'Refinar o diagnóstico com mais precisão.';
    const ajuda = raw.ajuda ? String(raw.ajuda).trim() : undefined;
    return {
        id,
        pergunta,
        tipo,
        objetivo,
        opcoes,
        ajuda: ajuda || undefined,
        rodada: typeof raw.rodada === 'number' && raw.rodada > 0 ? raw.rodada : rodadaPadrao
    };
}
export function normalizarPerguntasRefinamento(perguntas, rodadaPadrao = 1) {
    return perguntas
        .map((item) => normalizarPerguntaRefinamento((item && typeof item === 'object' ? item : {}), rodadaPadrao))
        .filter((item) => item !== null);
}
export function normalizarRefinamentoResponse(resposta, rodadaPadrao = 1) {
    const perguntas = normalizarPerguntasRefinamento(resposta.perguntas ?? [], rodadaPadrao).map(({ rodada: _rodada, ...pergunta }) => pergunta);
    return {
        perguntas,
        raciocinio: resposta.raciocinio
    };
}
