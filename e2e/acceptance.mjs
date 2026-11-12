/**
 * Teste de aceite do MVP (seção 18 da especificação), ponta a ponta no navegador:
 * recepção cadastra cliente e veículo → triagem → OS → mecânico diagnostica e monta itens →
 * recepção envia o orçamento → cliente aprova no portal → OS vai até "Entregue" →
 * histórico do veículo → super admin suspende e reativa a oficina.
 *
 * Pré-requisitos: API + app da oficina + painel admin rodando com o seed de desenvolvimento
 * (`npm run seed:dev`). Veja "Teste E2E" no README.
 *
 *   WEB_URL=http://localhost:4200 ADMIN_URL=http://localhost:4300 npm run test:e2e
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:4200';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4300';
const PASSWORD = process.env.SEED_PASSWORD ?? 'pitstop-dev-123';
const SHOTS = process.env.E2E_SCREENSHOTS;
const SLUG = 'oficina-demo';

const letters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const PLATE = `${letters()}${Math.floor(Math.random() * 10)}E${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
const CUSTOMER = `Cliente E2E ${PLATE}`;
const SECRET_DIAGNOSIS = `Diagnóstico interno ${PLATE}: pastilhas no fim`;

// PW_CHANNEL=chrome usa o Chrome já instalado na máquina (é o caso do CI) em vez do Chromium baixado pelo Playwright.
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
let step = 0;
/** Página do admin enquanto a oficina demo está suspensa pelo teste. */
let suspendedOn = null;

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: true });
}

async function session(base, email, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

const log = (message) => console.log(`✓ ${message}`);

try {
  // ── recepção: cliente, veículo, triagem, OS ──
  const reception = await session(WEB, 'recepcao@demo.local');
  await shot(reception, 'painel');
  await reception.goto(`${WEB}/triage/new`);
  await reception.getByLabel('Placa, nome ou telefone do cliente').fill(PLATE);
  await reception.getByRole('button', { name: 'Buscar' }).click();
  await reception.getByRole('button', { name: 'Cadastrar novo cliente' }).click();
  await reception.getByLabel('Nome', { exact: true }).fill(CUSTOMER);
  await reception.getByLabel('Telefone com DDD').fill('71988880000');
  await reception.getByRole('button', { name: 'Cadastrar e continuar' }).click();
  assert.equal(await reception.getByLabel('Placa', { exact: true }).inputValue(), PLATE, 'a placa buscada já vem preenchida');
  await reception.getByLabel('Marca', { exact: true }).fill('Ford');
  await reception.getByLabel('Modelo', { exact: true }).fill('Ka');
  await reception.getByRole('spinbutton', { name: 'Ano' }).fill('2019');
  await reception.getByRole('button', { name: 'Cadastrar veículo' }).click();
  log('cliente e veículo cadastrados');

  // etapa do mapa: a zona pode ser escolhida no carro 3D ou nos atalhos (via acessível, usada aqui)
  await reception.getByRole('button', { name: /Freios/ }).click();
  await reception
    .locator('ps-car-3d canvas')
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  await reception.waitForTimeout(1200);
  await shot(reception, 'triagem-mapa');
  await reception.getByRole('button', { name: 'Continuar' }).click();
  await reception.getByRole('checkbox').first().check();
  await shot(reception, 'triagem-sintomas');
  await reception.getByRole('button', { name: 'Continuar' }).click();
  await reception.getByRole('button', { name: 'Continuar' }).click();
  await reception.getByLabel('Observações em texto livre (opcional)').fill('Barulho ao frear, piora na descida.');
  await reception.getByRole('button', { name: 'Salvar triagem' }).click();
  await reception.getByRole('button', { name: 'Abrir ordem de serviço agora' }).click();
  await reception.waitForURL(/\/service-orders\/[0-9a-f-]{36}$/);
  const orderUrl = reception.url();
  await reception.getByLabel('Mecânico responsável').selectOption({ label: 'Seu Jorge (mecânico)' });
  await reception.getByText('Mecânico atribuído').waitFor();
  log('triagem convertida em OS e atribuída ao mecânico');

  // ── mecânico: diagnóstico com sugestões determinísticas, depois ignorando-as ──
  const mechanic = await session(WEB, 'mecanico@demo.local');
  await mechanic.goto(orderUrl);
  await mechanic.getByRole('button', { name: 'Iniciar diagnóstico' }).click();
  const suggestions = mechanic.getByRole('complementary', { name: 'Sugestões do motor de diagnóstico' });
  await suggestions.waitFor();
  assert.ok((await suggestions.getByText('Causas a considerar').count()) > 0, 'o painel traz causas');
  await shot(mechanic, 'diagnostico-sugestoes');
  await mechanic.getByRole('button', { name: 'Ignorar sugestões' }).click();
  await suggestions.waitFor({ state: 'detached' });
  await mechanic.getByLabel('Análise técnica (interna, o cliente não vê)').fill(SECRET_DIAGNOSIS);
  await mechanic.getByRole('button', { name: 'Salvar diagnóstico' }).click();
  await mechanic.getByText('Diagnóstico salvo').waitFor();

  await mechanic.getByRole('tab', { name: 'Orçamento' }).click();
  await mechanic.getByLabel('Descrição').fill('Troca de pastilhas dianteiras');
  await mechanic.getByLabel('Preço unitário (R$)').fill('120');
  await mechanic.getByRole('button', { name: 'Adicionar ao orçamento' }).click();
  await mechanic.getByRole('button', { name: 'Remover Troca de pastilhas dianteiras' }).waitFor();
  await mechanic.getByLabel('Tipo').selectOption('part');
  await mechanic.getByLabel('Descrição').fill('Jogo de pastilhas');
  await mechanic.getByLabel('Quantidade').fill('1');
  await mechanic.getByLabel('Preço unitário (R$)').fill('189.90');
  await mechanic.getByRole('button', { name: 'Adicionar ao orçamento' }).click();
  await mechanic.getByText('R$ 309,90').first().waitFor();
  log('mecânico ignorou as sugestões, registrou o diagnóstico e montou os itens do zero');

  // ── recepção: envia o orçamento ──
  await reception.reload();
  await reception.getByRole('tab', { name: 'Orçamento' }).click();
  await reception.getByRole('button', { name: 'Gerar link de aprovação' }).click();
  const portalUrl = await reception.getByLabel('Link de aprovação').inputValue();
  assert.match(portalUrl, /\/portal\/[\w-]+$/);
  await shot(reception, 'orcamento-enviado');
  log('orçamento enviado, link gerado');

  // ── cliente: portal público, sem sessão ──
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customer = await customerContext.newPage();
  await customer.goto(`${WEB}${new URL(portalUrl).pathname}`);
  await customer.getByRole('button', { name: 'Li e concordo, continuar' }).click();
  await customer.getByRole('heading', { name: 'Orçamento', exact: true }).waitFor();
  const portalText = await customer.locator('main').innerText();
  assert.ok(portalText.includes('Troca de pastilhas dianteiras'), 'o cliente vê os itens do orçamento');
  assert.ok(!portalText.includes(SECRET_DIAGNOSIS), 'o diagnóstico interno nunca aparece no portal');
  assert.ok(!portalText.includes('Causas a considerar'), 'as sugestões do motor nunca aparecem no portal');
  await shot(customer, 'portal-orcamento');
  await customer.getByRole('button', { name: 'Aprovar orçamento' }).click();
  await customer.getByText('Orçamento aprovado.').waitFor();
  await shot(customer, 'portal-aprovado');
  log('cliente aprovou pelo portal, sem ver dados internos');

  const invalid = await customerContext.newPage();
  await invalid.goto(`${WEB}/portal/00000000-0000-4000-8000-000000000000`);
  await invalid.getByRole('heading', { name: 'Link indisponível' }).waitFor();
  log('token inválido não revela nada');

  // ── execução até a entrega ──
  await mechanic.reload();
  await mechanic.getByRole('button', { name: 'Iniciar serviço' }).click();
  await mechanic.getByRole('button', { name: 'Concluir serviço' }).click();
  await reception.reload();
  await reception.getByRole('button', { name: 'Registrar entrega' }).click();
  await reception.getByRole('tab', { name: 'Timeline' }).click();
  // a entrega é assíncrona: espera o último evento aparecer antes de ler a timeline
  await reception.getByRole('tabpanel').getByText('Entregue').first().waitFor();
  const timeline = await reception.getByRole('tabpanel').innerText();
  for (const label of ['Rascunho', 'Em diagnóstico', 'Aguardando aprovação', 'Aprovada', 'Em execução', 'Concluída', 'Entregue']) {
    assert.ok(timeline.includes(label), `timeline registra "${label}"`);
  }
  await shot(reception, 'os-entregue');
  log('OS percorreu approved → in_progress → completed → delivered com timeline completa');

  // ── histórico do veículo e quadro ──
  await reception.goto(`${WEB}/vehicles`);
  await reception.getByPlaceholder('Buscar por placa, marca ou modelo').fill(PLATE);
  await reception.getByRole('button', { name: 'Buscar' }).click();
  await reception.getByRole('link', { name: new RegExp(CUSTOMER) }).click();
  await reception.getByRole('heading', { name: 'Histórico de serviços' }).waitFor();
  assert.equal(await reception.getByRole('link', { name: /OS \d+/ }).count(), 1, 'o histórico do veículo mostra a OS');
  await reception.goto(`${WEB}/service-orders`);
  await reception.getByRole('region', { name: 'Entregue' }).getByText(CUSTOMER).waitFor();
  await shot(reception, 'quadro');
  log('histórico do veículo e quadro de OS conferem');

  // ── gestão: financeiro, estoque, agenda, indicadores e avisos ──
  const owner = await session(WEB, 'dono@demo.local');
  await owner.goto(`${WEB}/financial`);
  const receivable = owner.getByRole('row', { name: new RegExp(PLATE) });
  await receivable.waitFor();
  await receivable.getByRole('button', { name: /Dar baixa/ }).click();
  await owner.getByText('Baixa registrada').waitFor();
  await shot(owner, 'financeiro');
  log('a OS concluída virou conta a receber e a gestão deu baixa');

  const SKU = `E2E-${PLATE}`;
  await owner.goto(`${WEB}/inventory`);
  await owner.getByRole('button', { name: 'Novo item' }).click();
  await owner.getByLabel('Nome').fill(`Pastilha ${PLATE}`);
  await owner.getByLabel('Código (SKU)').fill(SKU);
  await owner.getByLabel('Saldo inicial').fill('4');
  await owner.getByLabel('Estoque mínimo').fill('5');
  await owner.getByRole('button', { name: 'Cadastrar item' }).click();
  const stockRow = owner.getByRole('row', { name: new RegExp(SKU) });
  await stockRow.getByText('Repor').waitFor();
  await stockRow.getByRole('button', { name: /Movimentar/ }).click();
  await owner.getByLabel('Quantidade').fill('6');
  await owner.getByRole('button', { name: 'Registrar' }).click();
  await owner.getByText('Movimentação registrada').waitFor();
  assert.equal(await stockRow.getByText('Repor').count(), 0, 'a entrada tira o item do alerta de reposição');
  await shot(owner, 'estoque');
  log('estoque: item cadastrado, alerta de mínimo e entrada registrada');

  await owner.goto(`${WEB}/schedule`);
  await owner
    .getByLabel('Dia', { exact: true })
    .fill(`20${40 + Math.floor(Math.random() * 40)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 10)}`);
  const book = async (title) => {
    await owner.getByRole('button', { name: 'Novo agendamento' }).click();
    await owner.getByLabel('O que será feito').fill(title);
    await owner.getByLabel('Responsável').selectOption({ label: 'Seu Jorge (mecânico)' });
    await owner.getByRole('button', { name: 'Agendar', exact: true }).click();
  };
  await book(`Revisão ${PLATE}`);
  await owner.getByText('Agendamento criado').waitFor();
  await book(`Encaixe ${PLATE}`);
  await owner
    .getByRole('alert')
    .getByText(/já tem um agendamento nesse horário/)
    .waitFor();
  await shot(owner, 'agenda');
  log('agenda: agendamento criado e conflito de mecânico bloqueado');

  await owner.goto(`${WEB}/reports`);
  await owner.getByText('ticket médio').waitFor();
  await owner.getByRole('heading', { name: 'Faturamento por mês' }).waitFor();
  await shot(owner, 'indicadores');
  await owner.goto(`${WEB}/settings/notifications`);
  await owner.getByLabel('Veículo pronto').waitFor();
  await shot(owner, 'avisos');
  log('indicadores e modelos de aviso ao cliente disponíveis para a gestão');

  // ── super admin: suspender e reativar ──
  const admin = await session(ADMIN, 'admin@pitstop.local');
  await admin.getByRole('link', { name: 'Oficina Demo' }).click();
  await admin.getByLabel(/Para confirmar, digite o slug/).fill(SLUG);
  await shot(admin, 'admin-oficina');
  suspendedOn = admin;
  await admin.getByRole('button', { name: 'Suspender oficina' }).click();
  await admin.getByRole('button', { name: 'Reativar oficina' }).waitFor();

  await reception.goto(`${WEB}/dashboard`);
  await reception.getByRole('heading', { name: 'Acesso suspenso' }).waitFor();
  log('suspensão bloqueia os usuários da oficina imediatamente');

  await admin.getByRole('button', { name: 'Reativar oficina' }).click();
  await admin.getByRole('heading', { name: 'Suspender oficina' }).waitFor();
  suspendedOn = null;
  await reception.goto(`${WEB}/dashboard`);
  await reception.getByRole('heading', { name: 'Painel' }).waitFor();
  await admin.goto(`${ADMIN}/audit`);
  await admin.getByText('Oficina suspensa').first().waitFor();
  await shot(admin, 'admin-auditoria');
  log('reativação devolve o acesso e tudo fica na auditoria');

  console.log('\nAceite ponta a ponta: aprovado.');
} finally {
  // Se o teste quebrar com a oficina demo suspensa, devolve o acesso para não envenenar a próxima execução.
  if (suspendedOn) {
    await suspendedOn
      .getByRole('button', { name: 'Reativar oficina' })
      .click({ timeout: 5000 })
      .catch(() => console.error('Atenção: a oficina demo ficou suspensa. Reative pelo painel admin antes de rodar de novo.'));
  }
  await browser.close();
}
