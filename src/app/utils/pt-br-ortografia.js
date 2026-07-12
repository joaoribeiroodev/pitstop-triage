/**
 * Correção ortográfica pt-BR para textos gerados por IA (sem acentuação).
 * Código isomórfico (browser + serverless) — sem dependências Angular.
 */
/** Substituições de expressão (ordem importa). */
const FRASES = [
    [/\bnao\b/gi, 'não'],
    [/\bvoce\b/gi, 'você'],
    [/\bvc\b/gi, 'você'],
    [/\btambem\b/gi, 'também'],
    [/\bate\b/gi, 'até'],
    [/\bja\b/gi, 'já'],
    [/\bso\b/gi, 'só'],
    [/\bpra\b/gi, 'para'],
    [/\bta\b/gi, 'está'],
    [/\besta\b/gi, 'está'],
    [/\bestao\b/gi, 'estão'],
    [/\bsao\b/gi, 'são'],
    [/\bda pra\b/gi, 'dá para'],
    [/\bda para\b/gi, 'dá para'],
    [/\bdeve ser\b/gi, 'deve ser']
];
/** Palavras inteiras sem acento → forma correta. */
const CORRECOES = {
    nao: 'não',
    voce: 'você',
    tambem: 'também',
    ate: 'até',
    ja: 'já',
    so: 'só',
    sao: 'são',
    estao: 'estão',
    entao: 'então',
    mao: 'mão',
    oleo: 'óleo',
    peca: 'peça',
    pecas: 'peças',
    veiculo: 'veículo',
    codigo: 'código',
    codigos: 'códigos',
    diagnostico: 'diagnóstico',
    diagnosticos: 'diagnósticos',
    previo: 'prévio',
    mecanico: 'mecânico',
    mecanicos: 'mecânicos',
    eletrico: 'elétrico',
    eletrica: 'elétrica',
    eletricos: 'elétricos',
    eletricas: 'elétricas',
    hidraulico: 'hidráulico',
    hidraulica: 'hidráulica',
    metalico: 'metálico',
    metalica: 'metálica',
    historico: 'histórico',
    ultima: 'última',
    ultimo: 'último',
    homocinetica: 'homocinética',
    cambio: 'câmbio',
    pistao: 'pistão',
    valvula: 'válvula',
    valvulas: 'válvulas',
    jargao: 'jargão',
    ruido: 'ruído',
    ruidos: 'ruídos',
    fumaca: 'fumaça',
    cheiro: 'cheiro',
    urgencia: 'urgência',
    confianca: 'confiança',
    hipotese: 'hipótese',
    hipoteses: 'hipóteses',
    evidencia: 'evidência',
    evidencias: 'evidências',
    seguranca: 'segurança',
    observacoes: 'observações',
    acoes: 'ações',
    imediatas: 'imediatas',
    tecnica: 'técnica',
    tecnicas: 'técnicas',
    tecnico: 'técnico',
    tecnicos: 'técnicos',
    especifica: 'específica',
    especifico: 'específico',
    leigo: 'leigo',
    leigos: 'leigos',
    indisponivel: 'indisponível',
    disponivel: 'disponível',
    contingencia: 'contingência',
    ambigua: 'ambígua',
    ambiguo: 'ambíguo',
    possivel: 'possível',
    possiveis: 'possíveis',
    possivelmente: 'possivelmente',
    provavel: 'provável',
    provaveis: 'prováveis',
    provavelmente: 'provavelmente',
    necessario: 'necessário',
    necessaria: 'necessária',
    critica: 'crítica',
    critico: 'crítico',
    basica: 'básica',
    basico: 'básico',
    instavel: 'instável',
    estavel: 'estável',
    serio: 'sério',
    seria: 'séria',
    proxima: 'próxima',
    proximo: 'próximo',
    ignicao: 'ignição',
    injecao: 'injeção',
    direcao: 'direção',
    suspensao: 'suspensão',
    manutencao: 'manutenção',
    inspecao: 'inspeção',
    revisao: 'revisão',
    transmissao: 'transmissão',
    refrigeracao: 'refrigeração',
    alimentacao: 'alimentação',
    lubrificacao: 'lubrificação',
    operacao: 'operação',
    atencao: 'atenção',
    situacao: 'situação',
    informacao: 'informação',
    recomendacao: 'recomendação',
    compressao: 'compressão',
    combustivel: 'combustível',
    combustao: 'combustão',
    verificacao: 'verificação',
    identificacao: 'identificação',
    calibracao: 'calibração',
    conexao: 'conexão',
    rotacao: 'rotação',
    vibracao: 'vibração',
    aceleracao: 'aceleração',
    substituicao: 'substituição',
    previsao: 'previsão',
    analise: 'análise',
    conducao: 'condução',
    vedacoes: 'vedações',
    fixacoes: 'fixações',
    avaliacao: 'avaliação',
    frequencia: 'frequência',
    intensidade: 'intensidade',
    progressao: 'progressão',
    condicao: 'condição',
    condicoes: 'condições',
    discriminacao: 'discriminação',
    intermitente: 'intermitente',
    inspecionar: 'inspecionar',
    visualmente: 'visualmente',
    justificativa: 'justificativa',
    descarte: 'descarte',
    descartados: 'descartados',
    preventiva: 'preventiva',
    relacionada: 'relacionada',
    recomendada: 'recomendada',
    nivel: 'nível',
    niveis: 'níveis',
    centelha: 'centelha',
    bagunca: 'bagunça',
    crianca: 'criança'
};
/** Palavras que NÃO devem receber sufixo -ão automático. */
const EXCECOES_SUFIXO_AO = new Set(['cao', 'mao', 'pao', 'tao', 'sao', 'geo', 'video', 'audio', 'radio']);
function chaveSemAcento(palavra) {
    return palavra
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function temAcento(palavra) {
    return /[àáâãäåèéêëìíîïòóôõöùúûüçñÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑ]/.test(palavra);
}
function aplicarCapitalizacao(original, corrigida) {
    if (original === original.toUpperCase())
        return corrigida.toUpperCase();
    if (original[0] === original[0]?.toUpperCase()) {
        return corrigida.charAt(0).toUpperCase() + corrigida.slice(1);
    }
    return corrigida;
}
function aplicarSufixos(chave) {
    const r = chave;
    if (r.endsWith('aveis') && r.length > 6) {
        return r.slice(0, -4) + 'áveis';
    }
    if (r.endsWith('iveis') && r.length > 6) {
        return r.slice(0, -4) + 'íveis';
    }
    if (r.endsWith('coes') && r.length > 5) {
        return r.slice(0, -4) + 'ções';
    }
    if (r.endsWith('cao') && r.length > 4) {
        return r.slice(0, -3) + 'ção';
    }
    if (r.endsWith('oes') && r.length > 4) {
        return r.slice(0, -3) + 'ões';
    }
    if (r.endsWith('encia') && r.length > 6) {
        return r.slice(0, -5) + 'ência';
    }
    if (r.endsWith('ancia') && r.length > 6) {
        return r.slice(0, -5) + 'ância';
    }
    if (r.endsWith('avel') && r.length > 5) {
        return r.slice(0, -4) + 'ável';
    }
    if (r.endsWith('ivel') && r.length > 5) {
        return r.slice(0, -4) + 'ível';
    }
    if (r.endsWith('anca') && r.length > 5 && r.endsWith('guranca')) {
        return r.slice(0, -4) + 'ança';
    }
    if (r.endsWith('ao') && r.length > 3 && !EXCECOES_SUFIXO_AO.has(r) && !r.endsWith('cao')) {
        return r.slice(0, -2) + 'ão';
    }
    return r;
}
function corrigirPalavra(palavra) {
    const chave = chaveSemAcento(palavra);
    if (CORRECOES[chave]) {
        return aplicarCapitalizacao(palavra, CORRECOES[chave]);
    }
    if (temAcento(palavra)) {
        return palavra;
    }
    const comSufixo = aplicarSufixos(chave);
    if (comSufixo !== chave) {
        return aplicarCapitalizacao(palavra, comSufixo);
    }
    return palavra;
}
/** Corrige omissões frequentes de acentuação em pt-BR. */
export function corrigirOrtografiaPtBr(texto) {
    if (!texto)
        return texto;
    let t = texto;
    for (const [re, repl] of FRASES) {
        t = t.replace(re, repl);
    }
    // "E importante" → "É importante" (verbo, início de frase ou após ponto)
    t = t.replace(/([.!?]\s+)E(\s+)/g, '$1É$2');
    t = t.replace(/^E(\s+)/, 'É$1');
    return t.replace(/[A-Za-zÀ-ÿ]+/g, corrigirPalavra);
}
/** Normaliza pontuação para PDF (Helvetica / WinAnsi). */
export function normalizarTextoPdf(texto) {
    return corrigirOrtografiaPtBr(texto)
        .normalize('NFC')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\u00ad/g, '')
        .replace(/\u2014|\u2013|\u2012/g, '-')
        .replace(/\u00b7|\u2022|\u2023|\u2043/g, '-')
        .replace(/[\u2018\u2019\u2032]/g, "'")
        .replace(/[\u201c\u201d\u2033]/g, '"')
        .replace(/[\u2715\u2716\u2717\u2718\u2713\u2714]/g, '')
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
        .replace(/[\u2600-\u27BF]/g, '')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
export function corrigirValorProfundo(valor) {
    if (typeof valor === 'string')
        return corrigirOrtografiaPtBr(valor);
    if (Array.isArray(valor))
        return valor.map(corrigirValorProfundo);
    if (valor && typeof valor === 'object') {
        const obj = valor;
        const next = {};
        for (const [k, v] of Object.entries(obj))
            next[k] = corrigirValorProfundo(v);
        return next;
    }
    return valor;
}
