/**
 * Dev server local que emula o runtime das Vercel Serverless Functions.
 * - Carrega api/*.ts via tsx (TypeScript em runtime).
 * - Faz shim de req/res no formato VercelRequest/VercelResponse.
 * - Lê variaveis do .env automaticamente.
 *
 * Uso: tsx scripts/dev-api.mjs
 */
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv();

const PORT = Number(process.env.API_DEV_PORT ?? 3001);
const cwd = process.cwd();
const apiDir = join(cwd, 'api');

function ansi(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const tag = ansi('35', '[api]');

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return resolve({});
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function wrapResponse(res) {
  let statusCode = 200;
  const original = res;

  res.status = (code) => {
    statusCode = code;
    original.statusCode = code;
    return res;
  };

  res.json = (obj) => {
    if (!original.headersSent) {
      original.setHeader('Content-Type', 'application/json; charset=utf-8');
      original.statusCode = statusCode;
    }
    original.end(JSON.stringify(obj));
    return res;
  };

  res.send = (data) => {
    if (!original.headersSent) {
      original.statusCode = statusCode;
    }
    original.end(typeof data === 'string' ? data : JSON.stringify(data));
    return res;
  };

  return res;
}

if (!existsSync(apiDir)) {
  console.error(`${tag} Diretorio "api/" nao encontrado em ${cwd}`);
  process.exit(1);
}

const handlers = {};
for (const file of readdirSync(apiDir)) {
  if (!file.endsWith('.ts')) continue;
  if (file.startsWith('_')) continue;
  if (file === 'tsconfig.json') continue;
  const name = basename(file, '.ts');
  const url = pathToFileURL(join(apiDir, file)).href;
  try {
    const mod = await import(url);
    if (typeof mod.default !== 'function') {
      console.warn(`${tag} ${file} nao exporta um handler default — ignorando.`);
      continue;
    }
    handlers[`/api/${name}`] = mod.default;
    console.log(`${tag} ${ansi('32', '✓')} rota ${ansi('36', `/api/${name}`)}`);
  } catch (err) {
    console.error(`${tag} Falha ao carregar ${file}:`, err);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const handler = handlers[url.pathname];

  const started = Date.now();
  const finish = (code) => {
    const ms = Date.now() - started;
    const color = code >= 500 ? '31' : code >= 400 ? '33' : '32';
    console.log(`${tag} ${req.method} ${url.pathname} ${ansi(color, String(code))} ${ms}ms`);
  };

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Rota nao encontrada', rota: url.pathname }));
    finish(404);
    return;
  }

  try {
    req.body = await parseBody(req);
    req.query = Object.fromEntries(url.searchParams);
    wrapResponse(res);
    res.on('finish', () => finish(res.statusCode));
    await handler(req, res);
  } catch (err) {
    console.error(`${tag} erro em ${url.pathname}:`, err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Erro interno no dev server', detail: String(err) }));
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`${tag} ${ansi('31', '✗')} porta ${ansi('33', String(PORT))} ja esta em uso.`);
    console.error(`${tag}   Solucao 1: feche o processo que esta usando a porta.`);
    console.error(`${tag}   Solucao 2: rode com outra porta -> API_DEV_PORT=3002 npm run dev:api`);
    console.error(`${tag}   No Windows: Get-NetTCPConnection -LocalPort ${PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
    process.exit(1);
  }
  console.error(`${tag} erro no servidor:`, err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`${tag} ${ansi('32', '▶')} dev server pronto em ${ansi('36', `http://localhost:${PORT}`)}`);
  if (!process.env.OPENAI_API_KEY) {
    console.log(`${tag} ${ansi('33', '⚠')}  OPENAI_API_KEY ausente — endpoints de IA retornarao 500.`);
    console.log(`${tag}    Os fallbacks locais do frontend cobrem o fluxo.`);
  }
});

const shutdown = () => {
  console.log(`\n${tag} encerrando...`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
