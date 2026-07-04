# PitStop Triage — Contexto Completo do Projeto

> Documento gerado para fornecer contexto integral ao Gemini Pro (ou outro LLM) ao trabalhar em tarefas neste repositório.
> Repositório: `pitstop-triage` | Autor: João Pedro Lima Ribeiro | Licença: MIT

---

## 1. Visão geral

**PitStop Triage** é uma aplicação web de triagem automotiva guiada. Conduz motoristas ou recepcionistas de oficina por **5 etapas** e entrega um **CDP (Código de Diagnóstico Prévio)** estrutado — com hipóteses técnicas, urgência, custos estimados, códigos OBD possíveis e ações imediatas — **antes** da inspeção presencial na oficina.

**Público-alvo:** oficinas mecânicas, recepcionistas, entusiastas automotivos e clientes que precisam organizar sintomas antes de levar o carro ao mecânico.

**Problema que resolve:** reduz idas e vindas na recepção, organiza hipóteses técnicas e documenta o pré-diagnóstico de forma padronizada.

---

## 2. Stack tecnológica

| Camada         | Tecnologia                  | Versão / Detalhe                                       |
| -------------- | --------------------------- | ------------------------------------------------------ |
| Frontend       | Angular                     | 19.2 (NgModules, **não** standalone)                   |
| Estado reativo | Angular Signals             | `signal`, `computed`, `effect`                         |
| Estilo         | Tailwind CSS                | 3.4 — tema "pit lane" escuro (cores `pit-*`)           |
| 3D             | Three.js                    | 0.184 — visualização do carro na etapa Mapa            |
| PDF            | jsPDF                       | 2.5 — exportação do CDP no browser                     |
| HTTP           | RxJS + HttpClient           | timeout de 45s nas chamadas de IA                      |
| Backend        | Vercel Serverless Functions | TypeScript em `api/`                                   |
| IA             | Google Gemini               | `@google/genai` 0.14, modelo padrão `gemini-2.5-flash` |
| FIPE           | API Parallelum              | `https://parallelum.com.br/fipe/api/v1/carros`         |
| CI             | GitHub Actions              | lint + Prettier + typecheck API + build                |
| Deploy         | Vercel                      | SPA + functions serverless                             |
| Node           | >= 22                       | npm 10.9.2                                             |

---

## 3. Arquitetura

### 3.1 Padrão Angular modular

```
src/app/
├── components/    # Telas do fluxo + car-3d, lgpd-notice
├── services/      # TriageState, DiagnosticoApi, FIPE, PDF, LGPD
├── modules/       # pages.module, shared.module, pages.routes
├── models/        # Tipos e interfaces
├── guards/        # Guards de etapa e LGPD
├── constants/     # Steps, LGPD, exibição CDP
├── data/          # Catálogo de sintomas, fallbacks
├── utils/         # Ortografia pt-BR (browser + API)
├── app.module.ts
└── app-routing.module.ts
```

**Path aliases (tsconfig):**

- `@components/*` → `src/app/components/*`
- `@services/*` → `src/app/services/*`
- `@modules/*` → `src/app/modules/*`
- `@models/*`, `@guards/*`, `@constants/*`, `@data/*`, `@utils/*`

### 3.2 Estado centralizado

`TriageStateService` (`src/app/services/triage-state.service.ts`):

- Gerencia todo o estado da triagem via **Signals**
- Persiste automaticamente em `localStorage` (chave: `pitstop-triage/state/v2`)
- Computed signals para validação de progresso e guards de rota

`LgpdConsentService`:

- Consentimento LGPD em `localStorage` (chave: `pitstop-triage/lgpd/v1`)
- Versão da política: `POLITICA_PRIVACIDADE_VERSAO = '1.0.0'`

### 3.3 Backend serverless

```
api/
├── _shared.ts              # CORS, validação, chave Gemini
├── gerar-diagnostico.ts    # POST /api/gerar-diagnostico → CDP
└── refinar-triagem.ts      # POST /api/refinar-triagem → perguntas IA
```

Em desenvolvimento, `scripts/dev-api.mjs` emula as Vercel Functions na porta 3000; o Angular usa proxy (`proxy.conf.json`) para redirecionar `/api/*`.

---

## 4. Fluxo do usuário (5 etapas + telas auxiliares)

```
/inicio (boas-vindas + consentimento LGPD)
    ↓ consentimento aceito
/veiculo (FIPE ou manual)
    ↓ marca + modelo + ano preenchidos
/mapa (seleção de zona no carro 3D)
    ↓ zona selecionada
/sintomas (checklist contextualizado por zona)
    ↓ ≥1 sintoma marcado
/chat-ia (refinamento com perguntas geradas pelo Gemini)
    ↓ ≥1 resposta de refinamento
/resultado (geração do CDP + export PDF)
```

**Telas auxiliares:**

- `/privacidade` — política LGPD completa
- `/inicio` e `/privacidade` **não** exibem o chrome de triagem (stepper/progresso)

**Guards de rota:**
| Guard | Exige |
|-------|-------|
| `requireLgpdConsentGuard` | Consentimento LGPD (todas etapas da triagem) |
| `requireVeiculoGuard` | marca + modelo + ano |
| `requireZonaGuard` | zona selecionada |
| `requireSintomasGuard` | ≥1 sintoma |
| `requireRefinamentoGuard` | ≥1 resposta de refinamento |

Redirecionamentos em cascata: se faltar dado de etapa anterior, volta para a etapa correta.

---

## 5. Modelos de dados

### 5.1 Veículo (`Veiculo`)

```typescript
interface Veiculo {
  marca: string;
  modelo: string;
  ano: string;
  codigoFipe: string;
  origem: 'fipe' | 'manual' | '';
  observacoes?: string;
  fipeMarcaCodigo?: string;
  fipeModeloCodigo?: string;
  fipeAnoCodigo?: string;
}
```

### 5.2 Zonas do veículo (`ZonaId`)

6 zonas fixas em `src/app/data/sintomas.catalog.ts`:

| ID              | Label               | Sistemas relacionados                                     |
| --------------- | ------------------- | --------------------------------------------------------- |
| `motor`         | Motor               | Injeção, Ignição, Alimentação, Lubrificação, Sensores ECU |
| `freios`        | Freios              | Hidráulico, ABS, Atrito, Servofreio                       |
| `suspensao`     | Suspensão e Direção | Amortecedores, Molas, Bandejas, Direção                   |
| `eletrica`      | Elétrica            | Bateria, Alternador, Partida, Chicotes, Iluminação        |
| `transmissao`   | Transmissão         | Câmbio, Embreagem, Semieixos, TCU                         |
| `arrefecimento` | Arrefecimento       | Radiador, Bomba d'água, Termostática, Ventoinhas          |

Cada zona tem **10 sintomas** pré-definidos em linguagem acessível ao cliente (total: 60 sintomas no catálogo).

**Regra de invalidação:** ao trocar de zona, sintomas, respostas de refinamento e diagnóstico são **resetados**.

### 5.3 Snapshot de triagem (`TriageSnapshot`)

Payload enviado às APIs de IA:

```typescript
interface TriageSnapshot {
  veiculo: Veiculo;
  zonaSelecionada: ZonaId | '';
  sintomas: string[];
  respostasRefinamento: Record<string, string>; // chave = id da pergunta
}
```

### 5.4 Pergunta de refinamento

```typescript
interface PerguntaRefinamento {
  id: string; // ex: "q_temp", "q_freq"
  pergunta: string;
  tipo: 'multipla_escolha' | 'sim_nao' | 'escala';
  objetivo: string; // exibido ao usuário
  opcoes: string[];
  ajuda?: string;
}
```

### 5.5 CDP — Diagnóstico Prévio (`DiagnosticoCdp`)

```typescript
interface DiagnosticoCdp {
  urgencia_geral: 'baixa' | 'media' | 'alta' | 'critica';
  pode_dirigir: 'sim_normal' | 'sim_com_cautela' | 'apenas_curtas_distancias' | 'nao_dirigir';
  risco_principal: string;
  observacoes_seguranca: string;
  acoes_imediatas: string[]; // 3-5 itens
  hipoteses: HipoteseDiagnostica[]; // 1-4 itens
  diagnosticos_descartados?: DiagnosticoDescartado[];
  manutencao_preventiva_relacionada?: string[];
  proxima_inspecao_recomendada?: string;
  resumo_para_cliente: string;
}

interface HipoteseDiagnostica {
  titulo: string;
  sistema_afetado: string;
  probabilidade: number; // 0-100
  confianca: 'baixa' | 'media' | 'alta';
  justificativa_tecnica: string;
  evidencias_usadas: string[]; // 2-4 citações concretas
  componentes_a_verificar: ComponenteVerificar[];
  codigos_obd_possiveis?: string[]; // opcional, nunca inventar
  custo_estimado_brl: { min: number; max: number };
  tempo_reparo_horas: { min: number; max: number };
}
```

---

## 6. APIs e integrações

### 6.1 POST `/api/refinar-triagem`

**Entrada:**

```json
{
  "veiculo": { "marca": "...", "modelo": "...", "ano": "..." },
  "zonaSelecionada": "motor",
  "sintomas": ["Marcha lenta instável ou apagando", "..."],
  "respostasRefinamento": { "q_temp": "Mais com o carro frio" },
  "rodada": 1
}
```

**Saída:**

```json
{
  "perguntas": [{ "id": "...", "pergunta": "...", "tipo": "...", "objetivo": "...", "opcoes": ["..."] }],
  "raciocinio": "..." // opcional
}
```

**Comportamento IA:**

- Rodada 1: 2-3 perguntas discriminantes
- Rodada 2: 2 perguntas complementares (aprofundamento)
- Temperature: 0.35 | maxOutputTokens: 1536
- System prompt focado em perguntas que **eliminam hipóteses concorrentes**
- Linguagem simples para leigo, português do Brasil

**Fallback local:** `src/app/data/refinamento.fallback.ts` — usado se API falhar ou timeout (45s).

### 6.2 POST `/api/gerar-diagnostico`

**Entrada:** `TriageSnapshot` completo (inclui `respostasRefinamento`).

**Saída:** objeto `DiagnosticoCdp` conforme JSON Schema rigoroso.

**Comportamento IA:**

- Temperature: 0.2
- System prompt de "diagnóstico automotivo senior (20+ anos)"
- Inclui few-shot example (Gol 1.0 2020, zona motor)
- Regras: calibração probabilidade vs confiança, segurança primeiro, custos em BRL, nunca inventar OBD
- Fallback local: `src/app/data/cdp.fallback.ts`

### 6.3 API FIPE (client-side)

`FipeService` consulta diretamente do browser:

- `GET /marcas`
- `GET /marcas/{marca}/modelos`
- `GET /marcas/{marca}/modelos/{modelo}/anos`
- `GET /marcas/{marca}/modelos/{modelo}/anos/{ano}` → retorna `CodigoFipe`, `Marca`, `Modelo`, `AnoModelo`

Se FIPE falhar, usuário pode usar **modo manual** (marca, modelo, ano, versão, observações).

---

## 7. Componentes principais

### 7.1 Páginas

| Componente                 | Rota           | Responsabilidade                                         |
| -------------------------- | -------------- | -------------------------------------------------------- |
| `BoasVindasPageComponent`  | `/inicio`      | Apresentação + checkbox LGPD + "Começar"                 |
| `PrivacidadePageComponent` | `/privacidade` | Política completa (seções de `lgpd.constants.ts`)        |
| `VeiculoPageComponent`     | `/veiculo`     | FIPE em cascata ou cadastro manual                       |
| `MapaPageComponent`        | `/mapa`        | Seleção de zona via `Car3dComponent` + atalhos           |
| `SintomasPageComponent`    | `/sintomas`    | Checklist filtrado por zona                              |
| `ChatIaPageComponent`      | `/chat-ia`     | Carrega perguntas IA (rodadas 1 e 2), coleta respostas   |
| `ResultadoPageComponent`   | `/resultado`   | Gera CDP, exibe resultado, exporta PDF, reinicia triagem |

### 7.2 Shared

| Componente            | Uso                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `Car3dComponent`      | Three.js — carro 3D estilizado com hotspots por zona, OrbitControls, labels HTML sobrepostos |
| `LgpdNoticeComponent` | Aviso compacto de privacidade                                                                |

### 7.3 App shell (`AppComponent`)

- Stepper com 5 etapas (`TRIAGE_STEPS`)
- Barra de progresso (% baseado em etapas completadas)
- Indicador de urgência quando CDP gerado
- Botões "Reiniciar triagem" e "Excluir meus dados" (revoga LGPD)

---

## 8. Serviços

| Serviço                 | Arquivo                      | Função                                                 |
| ----------------------- | ---------------------------- | ------------------------------------------------------ |
| `TriageStateService`    | `triage-state.service.ts`    | Estado + persistência localStorage                     |
| `DiagnosticoApiService` | `diagnostico-api.service.ts` | POST `/api/gerar-diagnostico` e `/api/refinar-triagem` |
| `FipeService`           | `fipe.service.ts`            | Consultas FIPE                                         |
| `CdpPdfService`         | `cdp-pdf.service.ts`         | Gera PDF A4 com layout profissional                    |
| `LgpdConsentService`    | `lgpd-consent.service.ts`    | Consentimento LGPD                                     |

**Timeout IA:** `AI_REQUEST_TIMEOUT_MS = 45_000` (45 segundos).

---

## 9. Variáveis de ambiente

```env
GEMINI_API_KEY=sua_chave_aqui          # Obrigatória para IA
GEMINI_MODEL=gemini-2.5-flash          # Opcional (padrão)
API_DEV_PORT=3000                      # Opcional (dev server)
```

Sem `GEMINI_API_KEY`: APIs retornam 500; frontend usa fallbacks locais e continua funcional.

---

## 10. Scripts npm

| Comando                           | Descrição                                                 |
| --------------------------------- | --------------------------------------------------------- |
| `npm run dev`                     | Angular (4200) + API dev (3000) em paralelo               |
| `npm start`                       | Só frontend (IA indisponível, fallbacks)                  |
| `npm run start:full`              | `vercel dev` — runtime unificado                          |
| `npm run build`                   | Build produção → `dist/pitstop-triage/browser`            |
| `npm run check`                   | lint + format:check + typecheck:api + build (pipeline CI) |
| `npm run lint` / `lint:fix`       | ESLint                                                    |
| `npm run format` / `format:check` | Prettier                                                  |

---

## 11. LGPD e privacidade

- **Sem banco de dados:** dados ficam no `localStorage` do browser
- **Backend stateless:** requisições à IA não são persistidas
- **Dados coletados:** veículo, zona, sintomas, respostas IA, observações opcionais
- **Não coleta:** nome, CPF, e-mail, telefone, placa
- **Terceiros:** API FIPE (Parallelum) + Google Gemini
- **Direitos:** botão "Excluir meus dados" no rodapé revoga consentimento e limpa localStorage
- **Header API:** `X-Privacy-Policy: Dados processados apenas para triagem; sem persistência em banco.`

---

## 12. Design system (Tailwind)

Tema escuro "pit lane" com acento laranja (`pit-signal`):

```
pit-bg: #070B14       pit-surface: #0D1424       pit-card: #111B30
pit-signal: #FB923C   pit-safe: #22C55E           pit-warn: #FACC15
pit-danger: #EF4444   pit-cyan: #22D3EE
```

Fontes: Space Grotesk (display), Inter (sans), JetBrains Mono (mono).

Badges de urgência/confiança/prioridade em `src/app/constants/cdp-display.ts`.

---

## 13. Resiliência e fallbacks

| Cenário                               | Comportamento                                               |
| ------------------------------------- | ----------------------------------------------------------- |
| API Gemini indisponível / timeout 45s | Fallback local de perguntas ou CDP genérico por zona        |
| FIPE indisponível                     | Modo manual habilitado com mensagem de erro                 |
| localStorage cheio                    | Erro silenciosamente ignorado no `effect` de persistência   |
| Rodada IA recarregada                 | Respostas da rodada anterior são limpas (`limparRespostas`) |

---

## 14. CI/CD

**GitHub Actions** (`/.github/workflows/ci.yml`):

- Trigger: push/PR em `main` ou `master`
- Node 22, `npm ci`
- ESLint → Prettier check → typecheck API → build
- Artifact do build em push para main (7 dias retenção)

**Vercel** (`vercel.json`):

- Build: `npm run build`
- Output: `dist/pitstop-triage/browser`
- Rewrites: `/api/*` → functions | `/*` → `index.html` (SPA)

---

## 15. Roadmap

### Implementado

- [x] Fluxo 5 etapas com stepper
- [x] FIPE + entrada manual
- [x] Mapa 3D Three.js
- [x] Refinamento e CDP via Gemini + fallbacks
- [x] Exportação PDF
- [x] LGPD (consentimento, política, exclusão)
- [x] CI GitHub Actions

### Planejado

- [ ] Testes automatizados (unit + e2e)
- [ ] Internacionalização (i18n)
- [ ] Painel/API para oficinas receberem CDP
- [ ] Histórico de triagens com backend opcional
- [ ] PWA offline (etapas sem IA)

---

## 16. Convenções de código

- **Angular NgModules** (componentes `standalone: false`)
- **ChangeDetectionStrategy.OnPush** em todos os componentes
- **Signals** para estado reativo (não NgRx)
- **Functional guards** (`CanActivateFn`)
- **Path aliases** `@components`, `@services`, `@modules`, `@models`, `@guards`, `@constants`, `@data`, `@utils`
- **TypeScript strict** habilitado
- **Idioma do código:** português do Brasil (labels, prompts IA, mensagens de erro)
- **Comentários:** mínimos, apenas para lógica não óbvia
- **Prettier + ESLint** (angular-eslint 21)

---

## 17. Estrutura completa de arquivos

```
pitstop-triage/
├── api/
│   ├── _shared.ts
│   ├── gerar-diagnostico.ts
│   ├── refinar-triagem.ts
│   └── tsconfig.json
├── scripts/
│   ├── dev-api.mjs
│   └── predev.mjs
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── boas-vindas/
│   │   │   ├── chat-ia/
│   │   │   ├── mapa/
│   │   │   ├── privacidade/
│   │   │   ├── resultado/
│   │   │   ├── sintomas/
│   │   │   ├── veiculo/
│   │   │   ├── car-3d/
│   │   │   └── lgpd-notice/
│   │   ├── services/
│   │   │   ├── cdp-pdf.service.ts
│   │   │   ├── diagnostico-api.service.ts
│   │   │   ├── fipe.service.ts
│   │   │   ├── lgpd-consent.service.ts
│   │   │   └── triage-state.service.ts
│   │   ├── modules/
│   │   │   ├── pages.module.ts
│   │   │   ├── pages.routes.ts
│   │   │   └── shared.module.ts
│   │   ├── models/
│   │   ├── guards/
│   │   ├── constants/
│   │   ├── data/
│   │   ├── utils/
│   │   ├── app.component.ts/html
│   │   ├── app.module.ts
│   │   └── app-routing.module.ts
│   ├── index.html
│   ├── main.ts
│   └── styles.css
├── .github/workflows/ci.yml
├── .env.example
├── angular.json
├── eslint.config.js
├── package.json
├── postcss.config.js
├── proxy.conf.json
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.app.json
└── vercel.json
```

---

## 18. Diagrama de fluxo de dados

```
[Usuário]
    │
    ▼
[Angular SPA] ──localStorage──► TriageStateService (Signals)
    │
    ├──► FIPE API (browser) ──► identificação veículo
    │
    ├──► POST /api/refinar-triagem ──► Gemini ──► PerguntaRefinamento[]
    │         (fallback local se falhar)
    │
    └──► POST /api/gerar-diagnostico ──► Gemini ──► DiagnosticoCdp
              (fallback local se falhar)
                    │
                    ▼
              CdpPdfService ──► PDF download
```

---

## 19. Prompts de sistema (resumo)

### Refinamento (`refinar-triagem.ts`)

- Papel: consultor técnico automotivo senior
- Objetivo: perguntas que **discriminam** hipóteses concorrentes
- Tipos: multipla_escolha, sim_nao, escala
- Dimensões: temperatura, condição de uso, intensidade, sensorial, histórico
- Rodada 1: 2-3 perguntas | Rodada 2: 2 perguntas complementares

### CDP (`gerar-diagnostico.ts`)

- Papel: diagnóstico automotivo senior (20+ anos), especialista CDP
- Quantidades: 1-4 hipóteses, 3-5 ações, 2-4 evidências/hipótese, 2-6 componentes/hipótese
- Regras de ouro: calibração, evidências concretas, segurança primeiro, custos BRL, nunca inventar OBD
- Few-shot incluído no prompt

---

## 20. Notas para tarefas comuns

### Adicionar novo sintoma

Editar `sintomasPorZona` em `src/app/data/sintomas.catalog.ts`.

### Adicionar nova zona

1. Adicionar em `ZonaId`, `zonasCatalogo` e `sintomasPorZona` em `sintomas.catalog.ts`
2. Adicionar hotspot no `Car3dComponent`
3. Atualizar JSON Schema/prompts se necessário

### Alterar schema do CDP

1. `src/app/models/cdp.model.ts` (TypeScript)
2. `api/gerar-diagnostico.ts` (JSON Schema Gemini)
3. `cdp-pdf.service.ts` (renderização PDF)
4. Template `resultado-page.component.html` (UI)

### Alterar política LGPD

1. `src/app/constants/lgpd.constants.ts`
2. Incrementar `POLITICA_PRIVACIDADE_VERSAO` (invalida consentimentos antigos)

### Testar localmente com IA

```bash
# Criar .env com GEMINI_API_KEY
npm run dev
# Frontend: http://localhost:4200
# API: http://localhost:3000
```

---

_Documento gerado em julho/2026. Para atualizar, regenere a partir do estado atual do repositório._
