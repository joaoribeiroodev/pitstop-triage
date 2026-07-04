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

O **PitStop Triage** é uma aplicação web que conduz o motorista ou recepcionista de oficina por uma triagem em cinco etapas — veículo, zona do problema, sintomas e refinamento com IA — e entrega um **Código de Diagnóstico Prévio (CDP)** estruturado. O sistema reduz idas e vindas na recepção ao organizar hipóteses técnicas, urgência e ações imediatas antes da inspeção presencial. É voltado a oficinas, entusiastas e equipes que precisam de um pré-diagnóstico rápido e documentado.

---

## Funcionalidades

- 🚗 **Identificação do veículo** — consulta à tabela FIPE (API Parallelum) ou cadastro manual com observações
- 🗺️ **Mapa interativo da zona afetada** — seleção visual da área do problema com visualização 3D do veículo
- 🔧 **Catálogo de sintomas contextualizado** — checklist por zona, em linguagem acessível ao cliente
- 🤖 **Refinamento com IA** — perguntas geradas pelo Google Gemini para afinar o diagnóstico
- 📋 **CDP estruturado** — urgência, hipóteses calibradas, custos estimados, códigos OBD e ações imediatas
- 🔒 **Conformidade LGPD** — tela de boas-vindas com consentimento, política de privacidade e exclusão de dados locais

---

## Stack tecnológica

| Categoria | Tecnologia                  | Finalidade                                      |
| --------- | --------------------------- | ----------------------------------------------- |
| Frontend  | Angular 19                  | SPA modular com rotas, guards e Signals         |
| Frontend  | Tailwind CSS 3              | Estilização utilitária e tema racing/pit lane   |
| Frontend  | Three.js                    | Visualização 3D do veículo na etapa de mapa     |
| Frontend  | jsPDF                       | Geração do CDP em PDF no navegador              |
| Frontend  | RxJS                        | Fluxos assíncronos e integração HTTP            |
| Backend   | Vercel Serverless Functions | Endpoints `/api` em TypeScript                  |
| Backend   | `@google/genai`             | Chamadas ao modelo Gemini com JSON Schema       |
| Backend   | API FIPE (Parallelum)       | Consulta de marcas, modelos, anos e valores     |
| DevOps    | GitHub Actions              | CI com lint, Prettier e build de produção       |
| DevOps    | Vercel                      | Hospedagem do frontend e das funções serverless |

---

## Começando

### Pré-requisitos

- **Node.js** `>= 22` (definido em `package.json` → `engines`)
- **npm** `10.9.2` (definido em `packageManager`)
- Chave da API **Google Gemini** (obrigatória para as etapas de IA em produção e desenvolvimento completo)

### Instalação

```bash
git clone https://github.com/joaoribeiroodev/pitstop-triage.git
cd pitstop-triage
npm ci
```

### Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# Obrigatória para /api/gerar-diagnostico e /api/refinar-triagem
GEMINI_API_KEY=sua_chave_aqui

# Opcional — padrão: gemini-2.5-flash
GEMINI_MODEL=gemini-2.5-flash

# Opcional — porta do servidor local de API (padrão: 3000)
API_DEV_PORT=3000
```

> Obtenha a chave gratuitamente em [Google AI Studio](https://aistudio.google.com/apikey).

### Execução local

**Ambiente completo (Angular + API local em paralelo):**

```bash
npm run dev
```

- Frontend: `http://localhost:4200` (proxy `/api` → `:3000`)
- API dev: `http://localhost:3000` (emula as Vercel Functions via `scripts/dev-api.mjs`)

**Somente frontend** (IA indisponível — componentes usam fallbacks locais):

```bash
npm start
```

**Runtime Vercel unificado** (frontend + serverless juntos):

```bash
npm run start:full
```

**Validar o mesmo pipeline do CI:**

```bash
npm run check
```

| Comando                | Descrição                                          |
| ---------------------- | -------------------------------------------------- |
| `npm run build`        | Build de produção em `dist/pitstop-triage/browser` |
| `npm run lint`         | ESLint (TypeScript, templates Angular e `api/`)    |
| `npm run lint:fix`     | ESLint com correção automática                     |
| `npm run format`       | Formata o código com Prettier                      |
| `npm run format:check` | Verifica formatação (usado no CI)                  |

---

## Estrutura do projeto

```
pitstop-triage/
├── api/                          # Vercel Serverless Functions (Gemini)
│   ├── _shared.ts                # CORS, validação de triagem e chave Gemini
│   ├── gerar-diagnostico.ts      # POST — gera o CDP estruturado
│   └── refinar-triagem.ts        # POST — perguntas de refinamento da IA
├── scripts/
│   ├── dev-api.mjs               # Servidor HTTP local que emula as functions
│   └── predev.mjs                # Libera portas 3000/4200 antes do `npm run dev`
├── src/
│   ├── app/
│   │   ├── components/           # Telas e componentes reutilizáveis (car-3d, LGPD…)
│   │   ├── services/             # Serviços Angular (estado, API, FIPE, PDF)
│   │   ├── modules/              # NgModules (pages, shared) e rotas
│   │   ├── models/               # Interfaces e tipos
│   │   ├── guards/               # Guards de rota
│   │   ├── constants/            # Constantes e helpers de exibição
│   │   ├── data/                 # Catálogos e fallbacks locais
│   │   ├── utils/                # Utilitários (ex.: ortografia pt-BR)
│   │   ├── app.module.ts
│   │   └── app-routing.module.ts
│   ├── index.html
│   ├── main.ts                   # Bootstrap Angular
│   └── styles.css                # Estilos globais e utilitários Tailwind
├── .github/workflows/ci.yml      # Pipeline de lint, format e build
├── proxy.conf.json               # Proxy /api → localhost:3000 no ng serve
├── vercel.json                   # Build, output e rewrites para SPA + API
├── angular.json                  # Configuração do Angular CLI
└── package.json                  # Dependências, scripts e engines Node
```

**Padrão arquitetural:** Angular modular com pastas **components / services / modules**, além de **models**, **guards**, **constants**, **data** e **utils**. Estado centralizado em `TriageStateService` (Signals + `localStorage`) e rotas protegidas por guards.

---

## Roadmap

### Implementado

- [x] Fluxo de triagem em 5 etapas com stepper e progresso
- [x] Integração FIPE e entrada manual de veículo
- [x] Mapa 3D com Three.js para seleção de zona
- [x] Refinamento e CDP via Google Gemini com fallbacks locais
- [x] Exportação do CDP em PDF
- [x] Tela de boas-vindas, política de privacidade e fluxo LGPD
- [x] CI no GitHub Actions (lint, Prettier, build)

### Planejado

- [ ] Suíte de testes automatizados (unitários e e2e)
- [ ] Internacionalização (i18n) do fluxo de triagem
- [ ] Painel ou API para oficinas receberem o CDP diretamente
- [ ] Histórico de triagens com armazenamento opcional em backend
- [ ] Modo PWA para uso offline nas etapas sem IA

---

## Contribuindo

Contribuições são bem-vindas — bugs, melhorias de UX, ajustes no CDP e documentação ajudam bastante. Antes de abrir um PR, rode `npm run check` localmente. Consulte o [CONTRIBUTING.md](CONTRIBUTING.md) para diretrizes de branches, commits e revisão.

---

## Licença

Este projeto está sob a licença **MIT** (nenhum arquivo `LICENSE` foi encontrado no repositório; padrão adotado para projetos open source).

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
