# PitStop Triage

Plataforma web responsiva de **triagem automotiva inteligente** com tema racing/pit lane.
Captura veículo, zona afetada, sintomas e respostas guiadas → emite um **CDP (Código de Diagnóstico Prévio)** assistido por IA.

**Stack:** Angular 19 standalone + Signals · TailwindCSS 3 · Vercel Serverless · Google Gemini (`@google/genai`) · jsPDF.

## Rodando localmente

### Modo simples (sem IA — usa fallbacks locais)

```bash
npm install
npm start          # ng serve com proxy /api -> http://localhost:3000
```

### Modo completo (com IA Gemini)

Crie `.env` na raiz (apenas a chave do Gemini — o resto é 100% gratuito):

```bash
GEMINI_API_KEY=sua_chave_aqui
GEMINI_MODEL=gemini-2.5-flash       # opcional
```

> A chave do Gemini é obtida gratuitamente em https://aistudio.google.com/apikey (tier free com cota generosa).

Suba o ambiente Vercel:

```bash
npm i -g vercel
npm run start:full   # vercel dev (Angular + funções /api juntos em :3000)
```

> Se preferir rodar Angular separado (`npm start`) e Vercel em paralelo (`vercel dev --listen 3000`), o `proxy.conf.json` já encaminha `/api/*`.

## Fluxo

1. `/veiculo` — cascata **FIPE** (gratuita) **ou** entrada **manual** com campo livre de observações.
2. `/mapa` — SVG inline com zonas clicáveis (mouse, toque e teclado) + atalhos.
3. `/sintomas` — sintomas contextualizados, em linguagem leiga.
4. `/chat-ia` — 2 perguntas de refinamento geradas por Gemini (com fallback local).
5. `/resultado` — CDP técnico estruturado + download em PDF.

## Tema visual

- **Dark racing** permanente, com glassmorphism, glow neon laranja (`#FB923C`) e cyan (`#22D3EE`).
- Tipografia: **Space Grotesk** (display) + **Inter** (texto) + **JetBrains Mono** (números).
- Tokens em `tailwind.config.js` (`pit.*`) e utilitários em `src/styles.css`.

## Estrutura

```
src/
  app/
    app.component.ts          # header + stepper + progresso
    app.routes.ts
    core/
      triage-state.service.ts # Signals + persistência localStorage
      diagnostico-api.service.ts
      fipe.service.ts
      sintomas.catalog.ts
    pages/                    # veículo, mapa, sintomas, chat-ia, resultado
api/
  _shared.ts                  # CORS, validação, model
  gerar-diagnostico.ts        # POST → JSON Schema Gemini
  refinar-triagem.ts          # POST → 2 perguntas multi-escolha
proxy.conf.json
vercel.json
```

## Scripts

| Comando                | O que faz                                         |
| ---------------------- | ------------------------------------------------- |
| `npm start`            | Angular dev server (com proxy `/api → :3000`)     |
| `npm run start:full`   | `vercel dev` (Angular + serverless juntos)        |
| `npm run build`        | Build de produção (`dist/pitstop-triage/browser`) |
| `npm run lint`         | ESLint (TS + templates Angular + `api/`)          |
| `npm run lint:fix`     | ESLint com `--fix`                                |
| `npm run format`       | Prettier — formata todo o código                  |
| `npm run format:check` | Prettier check (usado no CI)                      |
| `npm run check`        | Pipeline completo: lint + format:check + build    |
| `npm test`             | (placeholder)                                     |

## CI

`.github/workflows/ci.yml` roda em todo push/PR: `npm ci → lint → format:check → build` (Node 20, cache npm, artifact do `dist/` em pushes).
