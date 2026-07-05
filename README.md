<p align="center">
  <h1 align="center">PitStop Triage</h1>
  <p align="center">Triagem automotiva guiada que gera um diagnóstico prévio (CDP) antes da visita à oficina.</p>
</p>

---

<p align="center">
  <img src="https://github.com/joaoribeiroodev/pitstop-triage/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Angular-19-DD0031?logo=angular&logoColor=white" alt="Angular" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white" alt="Vercel" />
</p>

---

## Sobre

O **PitStop Triage** conduz o motorista por uma triagem em cinco etapas — veículo, zona do problema, sintomas e refinamento com IA — e entrega um **Código de Diagnóstico Prévio (CDP)** em linguagem acessível. O resumo pode ser baixado em PDF e levado na oficina, reduzindo idas e vindas na recepção. Dados ficam no navegador (sem cadastro); a IA é acionada somente quando necessário.

---

## Funcionalidades

- **Identificação do veículo** — consulta FIPE (API Parallelum) ou cadastro manual
- **Mapa interativo** — seleção da zona afetada com visualização 3D (Three.js)
- **Sintomas contextualizados** — checklist por zona, em linguagem leiga
- **Refinamento com IA** — perguntas geradas pela OpenAI
- **CDP para o cliente** — resumo claro, urgência, hipóteses, roteiro para a oficina e detalhes técnicos colapsáveis
- **PDF local** — geração no navegador (jsPDF), sem envio a servidor
- **Triagem concluída** — confirmação de encerramento com CDP persistido no `localStorage`
- **LGPD** — consentimento na boas-vindas, política de privacidade e exclusão de dados locais
- **Ortografia pt-BR** — pós-processamento de textos da IA (acentos e termos automotivos)

---

## Stack tecnológica

| Categoria | Tecnologia                  | Finalidade                               |
| --------- | --------------------------- | ---------------------------------------- |
| Frontend  | Angular 19 (NgModules)      | SPA com rotas, guards, Signals e OnPush  |
| Frontend  | Tailwind CSS 3              | Tema automotivo (`pit-*`) e utilitários  |
| Frontend  | Three.js                    | Carro 3D na etapa de mapa                |
| Frontend  | jsPDF                       | PDF do CDP no navegador                  |
| Frontend  | RxJS                        | HTTP e fluxos assíncronos                |
| Backend   | Vercel Serverless Functions | Endpoints `/api` em TypeScript           |
| Backend   | OpenAI API                  | GPT com JSON Schema estruturado          |
| Backend   | API FIPE (Parallelum)       | Marcas, modelos, anos e valores          |
| DevOps    | GitHub Actions              | Lint, Prettier, typecheck da API e build |
| DevOps    | Vercel                      | Frontend + serverless                    |

---

## Fluxo da aplicação

```
/inicio          → boas-vindas + consentimento LGPD
/privacidade     → política de privacidade
/veiculo         → FIPE ou manual
/mapa            → zona no carro 3D
/sintomas        → checklist por zona
/chat-ia         → refinamento (OpenAI)
/resultado       → CDP + PDF + confirmar triagem
```

Guards garantem que cada etapa só seja acessada após a anterior. O progresso aparece no stepper do shell da aplicação.

---

## Começando

### Pré-requisitos

- **Node.js** `>= 22` (`engines` em `package.json`)
- **npm** `10.9.2` (`packageManager`)
- Chave **OpenAI** (obrigatória para IA em dev/produção)

### Instalação

```bash
git clone https://github.com/joaoribeiroodev/pitstop-triage.git
cd pitstop-triage
npm ci
```

### Variáveis de ambiente

Crie `.env` na raiz (use `.env.example` como referência):

```env
OPENAI_API_KEY=sua_chave_aqui
OPENAI_MODEL=gpt-4o-mini
API_DEV_PORT=3000
```

> Chave em [OpenAI Platform](https://platform.openai.com/api-keys).

### Execução local

| Comando                 | Descrição                                             |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Angular (`:4200`) + API local (`:3000`) em paralelo   |
| `npm start`             | Só frontend (IA indisponível — fallbacks locais)      |
| `npm run start:full`    | `vercel dev` — runtime unificado                      |
| `npm run check`         | Mesmo pipeline do CI (lint, format, typecheck, build) |
| `npm run build`         | Build em `dist/pitstop-triage/browser`                |
| `npm run lint`          | ESLint (`src/` + `api/`)                              |
| `npm run format`        | Prettier                                              |
| `npm run typecheck:api` | Typecheck das Vercel Functions                        |

**Dev completo:** `npm run dev` — proxy `/api` → `localhost:3000` (`proxy.conf.json` + `scripts/dev-api.mjs`).

---

## Estrutura do projeto

Organização **Angular clássica** — pastas por tipo de artefato (`components`, `services`, `modules`, etc.):

```
pitstop-triage/
├── api/                              # Vercel Serverless (permanece na raiz)
│   ├── _shared.ts                    # CORS, validação, OpenAI
│   ├── openai.ts                     # Cliente OpenAI (JSON estruturado)
│   ├── ai-schemas.ts                 # Schemas CDP e refinamento
│   ├── gerar-diagnostico.ts          # POST /api/gerar-diagnostico
│   ├── refinar-triagem.ts            # POST /api/refinar-triagem
│   └── tsconfig.json
├── scripts/
│   ├── dev-api.mjs                   # Emula as functions localmente
│   └── predev.mjs                    # Libera portas 3000/4200
└── src/
    ├── app/
    │   ├── components/               # Componentes Angular
    │   │   ├── boas-vindas/          # Telas do fluxo
    │   │   ├── veiculo/
    │   │   ├── mapa/
    │   │   ├── sintomas/
    │   │   ├── chat-ia/
    │   │   ├── resultado/
    │   │   ├── privacidade/
    │   │   ├── car-3d/               # Reutilizável (mapa 3D)
    │   │   └── lgpd-notice/          # Reutilizável (aviso LGPD)
    │   ├── services/                   # Serviços (providedIn: 'root')
    │   │   ├── triage-state.service.ts
    │   │   ├── diagnostico-api.service.ts
    │   │   ├── fipe.service.ts
    │   │   ├── cdp-pdf.service.ts
    │   │   └── lgpd-consent.service.ts
    │   ├── modules/
    │   │   ├── pages.module.ts       # Declara telas do fluxo
    │   │   ├── shared.module.ts      # Exporta car-3d e lgpd-notice
    │   │   └── pages.routes.ts       # Rotas /inicio … /resultado
    │   ├── models/                     # Interfaces (CDP, veículo, triagem…)
    │   ├── guards/                     # LGPD e progresso da triagem
    │   ├── constants/                  # Steps, LGPD, exibição do CDP
    │   ├── data/                       # Catálogo de sintomas, fallbacks
    │   ├── utils/                      # Ortografia pt-BR (browser + API)
    │   ├── app.module.ts
    │   ├── app-routing.module.ts
    │   └── app.component.*
    ├── index.html
    ├── main.ts
    └── styles.css
```

### Path aliases (`tsconfig.json`)

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

A API serverless reutiliza `@utils/*` e `@models/*` via `api/tsconfig.json` (sem dependência do Angular).

### Estado e persistência

- **`TriageStateService`** — Signals + `localStorage` (`pitstop-triage/state/v2`)
- **`LgpdConsentService`** — consentimento (`pitstop-triage/lgpd/v1`)
- Serviços registrados com `providedIn: 'root'` (sem `CoreModule`)

---

## Roadmap

### Implementado

- [x] Fluxo em 5 etapas com stepper e progresso
- [x] FIPE e entrada manual de veículo
- [x] Mapa 3D (Three.js)
- [x] Refinamento e CDP via OpenAI + fallbacks locais
- [x] CDP orientado ao cliente e PDF para oficina
- [x] Confirmação de triagem concluída
- [x] LGPD (consentimento, privacidade, exclusão local)
- [x] Correção ortográfica pt-BR nos textos da IA
- [x] CI (lint, Prettier, typecheck API, build)

### Planejado

- [ ] Testes automatizados (unitários e e2e)
- [ ] Internacionalização (i18n)
- [ ] Painel ou API para oficinas receberem o CDP
- [ ] Histórico de triagens com backend opcional
- [ ] PWA / modo offline nas etapas sem IA

---

## Contribuindo

Contribuições são bem-vindas. Antes de abrir um PR, rode `npm run check` localmente e mantenha o padrão de pastas (`components`, `services`, `modules`, …).

---

## Licença

Projeto sob licença **MIT**.

---

## Autor

<p align="center">
  <strong>João Pedro Lima Ribeiro</strong><br />
  Desenvolvedor do PitStop Triage
</p>

<p align="center">
  <a href="https://github.com/joaoribeiroodev">
    <img src="https://img.shields.io/badge/GitHub-joaoribeiroodev-181717?logo=github&logoColor=white" alt="GitHub" />
  </a>
</p>
