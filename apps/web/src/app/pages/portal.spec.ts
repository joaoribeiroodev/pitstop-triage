import type { PortalOrderResponse } from '@pitstop/shared-types';
import { mount } from '../../testing/harness';
import { PortalPage, PrivacyPage } from './portal.page';

const data = (overrides: Partial<PortalOrderResponse> = {}): PortalOrderResponse => ({
  shop: { name: 'Oficina Demo', phone: '71999990000' },
  order: { number: 7, status: 'awaiting_approval', status_label: 'Aguardando aprovação', opened_at: '2026-11-10T12:00:00Z', total_amount: 309.9 },
  vehicle: { plate: 'PIT1A23', brand: 'Ford', model: 'Ka', year: 2019 },
  reported_symptoms: [{ name: 'Chiado ao frear', answers: [{ question: 'Quando acontece?', answer: 'Sempre' }] }],
  customer_notes: 'Piora na descida',
  timeline: [{ status: 'draft', label: 'Rascunho', at: '2026-11-10T12:00:00Z' }],
  shop_messages: [{ body: 'Peça chega amanhã', at: '2026-11-10T13:00:00Z' }],
  quote: {
    id: 'q-1',
    version: 1,
    status: 'sent',
    total_amount: 309.9,
    sent_at: '2026-11-10T13:00:00Z',
    expires_at: '2026-12-10T13:00:00Z',
    can_respond: true,
    items: [
      { type: 'service', description: 'Troca de pastilhas', quantity: 1, unit_price: 120, total: 120 },
      { type: 'part', description: 'Jogo de pastilhas', quantity: 1, unit_price: 189.9, total: 189.9 }
    ]
  },
  consent_required: false,
  privacy_policy_version: '2026-11',
  ...overrides
});

const INTRO = { shop_name: 'Oficina Demo', consent_required: false, privacy_policy_version: '2026-11' };

async function openPortal(intro = INTRO, order = data()) {
  const page = await mount(PortalPage, { anonymous: true, inputs: { token: 'tok-123' } });
  const first = page.http.expectOne('/api/v1/portal/tok-123');
  expect(first.request.headers.has('Authorization')).toBeFalse();
  first.flush(intro);
  await page.settle();
  if (!intro.consent_required) {
    await page.respond('GET', '/portal/tok-123/order', order);
    await page.respond('GET', '/portal/tok-123/history', [
      {
        number: 3,
        status: 'delivered',
        status_label: 'Entregue',
        opened_at: '2026-06-01T12:00:00Z',
        delivered_at: '2026-06-02T12:00:00Z',
        total_amount: 250,
        services: ['Troca de óleo']
      }
    ]);
  }
  return page;
}

describe('portal do cliente', () => {
  it('pede o consentimento LGPD antes de mostrar qualquer dado do pedido', async () => {
    const page = await openPortal({ ...INTRO, consent_required: true });
    expect(page.text()).toContain('Antes de continuar');
    expect(page.text()).not.toContain('PIT');
    page.http.expectNone('/api/v1/portal/tok-123/order');

    await page.click('Li e concordo, continuar');
    await page.respond('POST', '/portal/tok-123/consent', {});
    await page.respond('GET', '/portal/tok-123/order', data());
    await page.respond('GET', '/portal/tok-123/history', []);
    expect(page.text()).toContain('Ordem de serviço 7');
  });

  it('mostra veículo, orçamento item a item, andamento, recados e histórico do veículo', async () => {
    const page = await openPortal();
    const text = page.text();
    for (const expected of [
      'Oficina Demo',
      'Ford Ka 2019',
      'Troca de pastilhas',
      'Jogo de pastilhas',
      'R$ 309,90',
      'Rascunho',
      'Peça chega amanhã',
      'Chiado ao frear',
      'Piora na descida',
      'OS 3',
      'Troca de óleo',
      '(71) 99999-0000'
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain('Aprovar orçamento');
    expect(text).toContain('Recusar');
  });

  it('aprova o orçamento e passa a mostrar a nova situação', async () => {
    const page = await openPortal();
    await page.click('Aprovar orçamento');
    const approved = data({
      order: { ...data().order, status: 'approved', status_label: 'Aprovada' },
      quote: { ...data().quote!, status: 'approved', can_respond: false }
    });
    expect(await page.respond('POST', '/portal/tok-123/quotes/q-1/approve', approved)).toEqual({});
    expect(page.text()).toContain('Orçamento aprovado. A oficina já foi avisada');
    expect(page.text()).not.toContain('Aprovar orçamento');
    expect(page.text()).toContain('Situação do orçamento: Aprovado.');
  });

  it('recusa com motivo opcional; erro do servidor aparece sem perder a tela', async () => {
    const page = await openPortal();
    await page.click('Recusar');
    page.component.reason = ' Achei caro ';
    await page.click('Confirmar recusa');
    const sent = await page.respond('POST', '/portal/tok-123/quotes/q-1/reject', { message: 'Este orçamento não está mais disponível.' }, 409);
    expect(sent).toEqual({ reason: 'Achei caro' });
    expect(page.text()).toContain('Este orçamento não está mais disponível.');

    await page.click('Confirmar recusa');
    await page.respond('POST', '/portal/tok-123/quotes/q-1/reject', data({ quote: { ...data().quote!, status: 'rejected', can_respond: false } }));
    expect(page.text()).toContain('Recusa registrada.');
    expect(page.component.rejecting()).toBeFalse();
  });

  it('sem orçamento pendente, não há o que responder', async () => {
    const page = await openPortal(INTRO, data({ quote: null, shop_messages: [], reported_symptoms: [], customer_notes: null }));
    await page.component.respond('approve');
    page.http.expectNone((request) => request.method === 'POST');
    expect(page.text()).not.toContain('Orçamento');
  });

  it('token inválido, expirado ou revogado: mesma tela, sem revelar nada', async () => {
    const page = await mount(PortalPage, { anonymous: true, inputs: { token: 'ruim' } });
    await page.respond('GET', '/portal/ruim', { message: 'Link inválido ou expirado.' }, 404);
    expect(page.text()).toBe('Link indisponívelEste link é inválido ou expirou. Peça um novo link à oficina.');

    const late = await openPortal({ ...INTRO, consent_required: true });
    await late.click('Li e concordo, continuar');
    await late.respond('POST', '/portal/tok-123/consent', { message: 'expirado' }, 404);
    expect(late.text()).toContain('Link indisponível');
  });

  it('política de privacidade explica controlador, base legal, retenção e contato', async () => {
    const page = await mount(PrivacyPage, { anonymous: true });
    for (const expected of ['Quem trata os seus dados', 'Base legal', 'Por quanto tempo', 'Seus direitos', 'Encarregado'])
      expect(page.text()).toContain(expected);
  });
});
