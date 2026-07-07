# PitStop Triage — Contexto Completo do Projeto

> Documento de referência para LLMs (Gemini, GPT, Claude, etc.) ao trabalhar neste repositório.
> Repositório: `pitstop-triage` | Autor: João Pedro Lima Ribeiro | Licença: MIT
> **Última atualização:** julho/2026

---

## 1. Visão geral

**PitStop Triage** é uma aplicação web de triagem automotiva guiada. Conduz o motorista por **5 etapas** e entrega um **CDP (Código de Diagnóstico Prévio)** — com hipóteses técnicas, urgência, custos estimados, códigos OBD possíveis e ações imediatas — **antes** da inspeção presencial na oficina.

**Público-alvo:** motoristas (linguagem leiga na UI) e mecânicos (detalhes técnicos colapsáveis no resultado/PDF).

**Problema que resolve:** organiza sintomas, reduz idas e vindas na recepção e gera um documento (PDF) para levar na oficina.

**Identidade visual:** logo em `public/logo.png` (favicon, header, boas-vindas, splash de carregamento).

---

## 2. Stack tecnológica

| Camada   | Tecnologia                  | Versão / Detalhe                                    |
| -------- | --------------------------- | --------------------------------------------------- |
| Frontend | Angular                     | 19.2 (NgModules, **não** standalone)                |
| Estado   | Angular Signals             | `signal`, `computed`, `effect`                      |
| Estilo   | **CSS puro**                | Tokens em `styles.css` + `*.component.css` por tela |
| 3D       | Three.js                    | 0.184 — carro 3D na etapa Mapa                      |
| PDF      | jsPDF                       | 2.5 — CDP gerado no browser                         |
| HTTP     | RxJS + HttpClient           | timeout **90s** nas chamadas de IA                  |
| Backend  | Vercel Serverless Functions | TypeScript em `api/`                                |
| IA       | **OpenAI API**              | `openai` 4.x, JSON Schema, padrão `gpt-4o-mini`     |
| FIPE     | API Parallelum              | `https://parallelum.com.br/fipe/api/v1/carros`      |
| CI       | GitHub Actions              | lint + Prettier + typecheck API + build             |
| Deploy   | Vercel                      | SPA + functions serverless                          |
| Node     | >= 22                       | npm 10.9.2                                          |

> **Nota histórica:** o projeto migrou de Google Gemini para OpenAI. Não há Tailwind — foi removido em favor de CSS por componente.

---

## 3. Arquitetura

### 3.1 Padrão Angular modular

```
src/app/
├── components/       # Telas do fluxo + car-3d, lgpd-notice
│   ├── boas-vindas/
│   ├── veiculo/
│   ├── mapa/
│   ├── sintomas/
│   ├── chat-ia/
│   ├── resultado/
│   ├── privacidade/
│   ├── car-3d/
│   └── lgpd-notice/
├── services/         # TriageState, DiagnosticoApi, FIPE, PDF, LGPD
├── modules/          # pages.module, shared.module, pages.routes
├── models/
├── guards/
├── constants/
├── data/             # Catálogos, fallbacks
├── utils/            # Ortografia pt-BR, refinamento, contingência CDP
├── app.module.ts
└── app-routing.module.ts
```

**Path aliases (`tsconfig.json`):**

| Alias           | Caminho                |
| --------------- | ---------------------- |
| `@components/*` | `src/app/components/*` |
| `@services/*`   | `src/app/services/*`   |
| `@modules/*`    | `src/app/modules/*`    |
| `@models/*`     | `src/app/models/*`     |
| `@guards/*`     | `src/app/guards/*`     |
| `@constants/*`  | `src/app/constants/*`  |
| `@data/*`       | `src/app/data/*`       |
| `@utils/*`      | `src/app/utils/*`      |

A API reutiliza `@utils/*` e `@models/*` via `api/tsconfig.json` (sem Angular).

### 3.2 Estilos

- **`src/styles.css`** — tokens CSS (`--pit-*`), reset, fundo `app-bg`, utilitários globais (`mt-*`, `animate-*`)
- **`*.component.css`** — estilos encapsulados por componente (`styleUrl` / `styleUrls`)
- Tema escuro “pit lane”, acento laranja `--pit-signal: #fb923c`
- Fontes: Space Grotesk, Inter, JetBrains Mono (Google Fonts em `index.html`)

### 3.3 Estado centralizado

**`TriageStateService`** (`triage-state.service.ts`):

- Signals + persistência automática em `localStorage` (`pitstop-triage/state/v2`)
- Campos persistidos: veículo, zona, sintomas, respostas/perguntas de refinamento, **`perguntasAtivas`**, **`rodadaRefinamentoMax`**, diagnóstico, **`diagnosticoFonte`**, **`triagemConcluida`**
- Computed: `podeIrParaMapa`, `podeIrParaSintomas`, `podeGerarDiagnostico`, `podeEmitirCdp`, `progresso`
- Ao trocar zona: reseta sintomas, refinamento e diagnóstico

**`LgpdConsentService`:**

- Chave: `pitstop-triage/lgpd/v1`
- Versão da política: **`POLITICA_PRIVACIDADE_VERSAO = '1.1.0'`**

### 3.4 Backend serverless

```
api/
├── _shared.ts              # CORS, validação triagem, OPENAI_MODEL
├── openai.ts               # Cliente OpenAI — structured JSON output
├── ai-schemas.ts           # JSON Schemas CDP e refinamento
├── cdp-validation.ts       # Validação do DiagnosticoCdp
├── gerar-diagnostico.ts    # POST /api/gerar-diagnostico
├── refinar-triagem.ts      # POST /api/refinar-triagem
└── tsconfig.json
```

**Dev:** `scripts/dev-api.mjs` emula functions na porta 3001; Angular usa `proxy.conf.json` (`/api/*` → localhost:3001). `scripts/predev.mjs` libera portas 3001/4200.

**Assets estáticos:** `public/` (ex.: `logo.png`) servido na raiz do build.

---

## 4. Fluxo do usuário

```
/inicio       → boas-vindas + consentimento LGPD (+ estado “triagem concluída” se aplicável)
/privacidade  → política LGPD
/veiculo      → FIPE ou manual
/mapa         → zona no carro 3D + atalhos laterais
/sintomas     → checklist por zona
/chat-ia      → refinamento IA (rodadas 1 e 2 opcional)
/resultado    → CDP + PDF + confirmar triagem concluída
```

**Guards:**

| Guard                     | Exige                      |
| ------------------------- | -------------------------- |
| `requireLgpdConsentGuard` | Consentimento LGPD         |
| `requireVeiculoGuard`     | marca + modelo + ano       |
| `requireZonaGuard`        | zona selecionada           |
| `requireSintomasGuard`    | ≥1 sintoma                 |
| `requireRefinamentoGuard` | ≥1 resposta de refinamento |

`/inicio` e `/privacidade` não exibem chrome de triagem (stepper/progresso).

**App shell:** stepper tipo telemetria, barra de progresso, reiniciar triagem, excluir dados (LGPD), logo no header.

---

## 5. Modelos de dados (resumo)

### Veículo (`Veiculo`)

`marca`, `modelo`, `ano`, `codigoFipe`, `origem` (`fipe` | `manual`), campos FIPE opcionais, `observacoes?`.

### Zonas (`ZonaId`) — 6 fixas

`motor`, `freios`, `suspensao`, `eletrica`, `transmissao`, `arrefecimento` — catálogo em `src/app/data/sintomas.catalog.ts` (10 sintomas/zona).

### Refinamento

```typescript
interface PerguntaRefinamento {
  id: string;
  pergunta: string;
  tipo: 'multipla_escolha' | 'sim_nao' | 'escala';
  objetivo: string;
  opcoes: string[];
  ajuda?: string;
}

interface PerguntaRefinamentoNaSessao extends PerguntaRefinamento {
  rodada: number;
}
```

Normalização: `src/app/utils/refinamento.util.ts` (garante `opcoes`, aliases `alternativas`/`options`, fallbacks).

### CDP (`DiagnosticoCdp`)

`urgencia_geral`, `pode_dirigir`, `risco_principal`, `observacoes_seguranca`, `acoes_imediatas`, `hipoteses[]`, `resumo_para_cliente`, campos opcionais (descartados, preventiva, inspeção).

**`resumo_para_cliente`:** 3–5 frases em linguagem leiga (causa provável, pode dirigir, urgência prática, o que fazer agora). Prompt em `api/gerar-diagnostico.ts`.

**Fonte do diagnóstico:** `DiagnosticoFonte = 'ia' | 'contingencia'` (`diagnosticoFonte` no state).

---

## 6. APIs

### POST `/api/refinar-triagem`

- Entrada: veículo, zona, sintomas, respostas anteriores, `rodada` (1 ou 2)
- Saída: `{ perguntas[], raciocinio? }`
- OpenAI structured output + normalização + ortografia pt-BR
- Rodada 1: 2–3 perguntas | Rodada 2: 2 complementares
- Fallback: `src/app/data/refinamento.fallback.ts`

### POST `/api/gerar-diagnostico`

- Entrada: snapshot completo + `respostasDetalhadas`
- Saída: `DiagnosticoCdp` validado (`cdp-validation.ts`)
- Temperature ~0.2, few-shot no prompt
- Fallback: `src/app/data/cdp.fallback.ts`

### FIPE (browser)

`FipeService` → Parallelum; modo manual se falhar.

---

## 7. Componentes principais

| Componente            | Rota           | Destaques                                            |
| --------------------- | -------------- | ---------------------------------------------------- |
| `BoasVindasPage`      | `/inicio`      | LGPD, logo, fluxo pós-triagem concluída              |
| `VeiculoPage`         | `/veiculo`     | FIPE cascata / manual, painel OBD lateral            |
| `MapaPage`            | `/mapa`        | Car3D + sidebar (zona, atalhos compactos)            |
| `SintomasPage`        | `/sintomas`    | Checklist por zona                                   |
| `ChatIaPage`          | `/chat-ia`     | Rodadas IA, persistência sessão, regerar explícito   |
| `ResultadoPage`       | `/resultado`   | CDP cliente + técnico colapsável, PDF, confirmar fim |
| `PrivacidadePage`     | `/privacidade` | Política LGPD                                        |
| `Car3dComponent`      | (mapa)         | Three.js, hotspots, OrbitControls                    |
| `LgpdNoticeComponent` | (várias)       | Aviso compacto OpenAI/FIPE                           |

---

## 8. Serviços

| Serviço                 | Função                                              |
| ----------------------- | --------------------------------------------------- |
| `TriageStateService`    | Estado + localStorage                               |
| `DiagnosticoApiService` | POST diagnóstico e refinamento (timeout **90s**)    |
| `FipeService`           | API FIPE                                            |
| `CdpPdfService`         | PDF A4 — resumo “Em poucas palavras” com caixa fixa |
| `LgpdConsentService`    | Consentimento LGPD                                  |

---

## 9. Variáveis de ambiente (`.env`)

```env
OPENAI_API_KEY=sua_chave_aqui      # Obrigatória para IA
OPENAI_MODEL=gpt-4o-mini           # Opcional
API_DEV_PORT=3001                  # Opcional
```

Sem chave: APIs retornam 500; frontend usa fallbacks locais.

---

## 10. Scripts npm

| Comando              | Descrição                                  |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | Angular :4200 + API :3001 (recomendado)    |
| `npm start`          | Alias de `npm run dev`                     |
| `npm run start:full` | `vercel dev`                               |
| `npm run check`      | lint + format + typecheck:api + build (CI) |
| `npm run build`      | `dist/pitstop-triage/browser`              |

---

## 11. LGPD

- Sem backend persistente; dados no `localStorage`
- Terceiros: **OpenAI** (refinamento + CDP), **FIPE** (Parallelum)
- Não coleta: nome, CPF, e-mail, telefone, placa
- “Excluir meus dados” no rodapé revoga consentimento e limpa storage

---

## 12. Design system (CSS)

Tokens principais em `:root` (`styles.css`):

```
--pit-bg: #070b14        --pit-surface: #0d1424      --pit-card: #111b30
--pit-signal: #fb923c    --pit-safe: #22c55e          --pit-warn: #facc15
--pit-danger: #ef4444    --pit-cyan: #22d3ee
```

Badges/labels CDP: `src/app/constants/cdp-display.ts`.

---

## 13. Resiliência e comportamentos importantes

| Cenário                         | Comportamento                                                      |
| ------------------------------- | ------------------------------------------------------------------ |
| IA timeout (90s) / erro         | Fallback local perguntas ou CDP contingência                       |
| FIPE indisponível               | Modo manual                                                        |
| **Regerar** perguntas (chat-ia) | Só limpa respostas da rodada ao clicar “Regerar” (`regerar: true`) |
| Rodada 2 refinamento            | **Acumula** perguntas da rodada 1 (não substitui)                  |
| Sessão chat-ia                  | `perguntasAtivas` restauradas ao reabrir `/chat-ia`                |
| Perguntas sem `opcoes`          | `refinamento.util.ts` normaliza antes de renderizar                |
| PDF “Em poucas palavras”        | Altura da caixa calculada antes do desenho (texto não vaza)        |
| Ortografia IA                   | `pt-br-ortografia.ts` / `corrigirValorProfundo` (browser + API)    |

---

## 14. CI/CD

- **GitHub Actions:** push/PR em `main` → `npm run check`
- **Vercel:** build Angular + serverless; SPA rewrite + `/api/*` → functions

---

## 15. Roadmap

### Implementado

- [x] Fluxo 5 etapas + stepper telemetria
- [x] FIPE + manual
- [x] Mapa 3D + layout sidebar refinado
- [x] Refinamento e CDP via **OpenAI** + fallbacks
- [x] CDP orientado ao cliente (resumo rico) + PDF oficina
- [x] Confirmação triagem concluída
- [x] LGPD 1.1.0
- [x] CSS por componente (sem Tailwind)
- [x] Logo `public/logo.png`
- [x] Ortografia pt-BR pós-IA
- [x] Persistência sessão refinamento
- [x] CI GitHub Actions

### Planejado

- [ ] Testes automatizados (unit + e2e)
- [ ] i18n
- [ ] Painel/API para oficinas
- [ ] Histórico com backend opcional
- [ ] PWA offline (etapas sem IA)

---

## 16. Convenções de código

- NgModules, `standalone: false`
- `ChangeDetectionStrategy.OnPush` nos componentes
- Signals (sem NgRx)
- Guards funcionais (`CanActivateFn`)
- Path aliases `@components`, `@services`, etc.
- TypeScript strict
- UI e prompts em **português do Brasil**
- Prettier + ESLint (angular-eslint 21)
- Um `*.component.css` por componente de página/shared

---

## 17. Estrutura de arquivos (raiz)

```
pitstop-triage/
├── api/                    # Vercel serverless
├── public/
│   └── logo.png
├── scripts/
│   ├── dev-api.mjs
│   └── predev.mjs
├── src/
│   ├── app/                # (ver §3.1)
│   ├── index.html
│   ├── main.ts
│   └── styles.css          # tokens + utilitários globais
├── .github/workflows/ci.yml
├── .env.example
├── angular.json
├── eslint.config.js
├── proxy.conf.json
├── tsconfig.json
└── vercel.json
```

---

## 18. Fluxo de dados

```
[Usuário]
    │
    ▼
[Angular SPA] ──localStorage──► TriageStateService (Signals)
    │
    ├──► FIPE API (browser)
    │
    ├──► POST /api/refinar-triagem ──► OpenAI ──► PerguntaRefinamento[]
    │         (fallback + normalização se falhar)
    │
    └──► POST /api/gerar-diagnostico ──► OpenAI ──► DiagnosticoCdp
              (fallback contingência se falhar)
                    │
                    ▼
              CdpPdfService ──► download PDF (jsPDF, local)
```

---

## 19. Tarefas comuns

### Adicionar sintoma / zona

`src/app/data/sintomas.catalog.ts` + hotspot em `car-3d.component.ts`.

### Alterar schema CDP

1. `src/app/models/cdp.model.ts`
2. `api/ai-schemas.ts` + `api/gerar-diagnostico.ts`
3. `cdp-pdf.service.ts` + `resultado-page.component.html`

### Alterar política LGPD

`lgpd.constants.ts` + incrementar `POLITICA_PRIVACIDADE_VERSAO`.

### Testar com IA local

```bash
cp .env.example .env   # OPENAI_API_KEY=...
npm run dev
# http://localhost:4200  |  API http://localhost:3001
```

### Trocar logo

Substituir `public/logo.png` (usada em header, boas-vindas, favicon, splash).

---

_Documento mantido manualmente. Regenerar quando houver mudanças estruturais relevantes (stack, APIs, persistência, fluxo)._
