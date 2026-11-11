import type { TriageSession, Vehicle } from '@pitstop/shared-types';
import { CATALOG, mount, order } from '../../testing/harness';
import { PublicTriagePage } from './public-triage.page';
import { TriageDetailPage, TriageListPage, TriageWizardPage } from './triage.page';

const VEHICLE: Vehicle = {
  id: 'veh-1',
  customer_id: 'cust-1',
  plate: 'PIT1A23',
  brand: 'Ford',
  model: 'Ka',
  year: 2019,
  color: null,
  vin: null,
  fuel_type: null,
  current_mileage: null,
  notes: null,
  created_at: '',
  updated_at: '',
  customer_name: 'Marina Souza',
  customer_phone: '71988887777'
};

const session = (overrides: Partial<TriageSession> = {}): TriageSession => ({
  id: 'triage-1',
  customer_id: 'cust-1',
  vehicle_id: 'veh-1',
  reported_symptoms: [{ symptom_code: 'brake_noise', answers: { when: 'Sempre' } }],
  free_form_notes: 'Piora na descida',
  status: 'pending',
  source: 'staff',
  contact: null,
  service_order_id: null,
  created_at: '2026-11-10T12:00:00Z',
  customer_name: 'Marina Souza',
  vehicle_plate: 'PIT1A23',
  vehicle_label: 'Ford Ka 2019',
  ...overrides
});

describe('triagem no balcão', () => {
  it('lista as pendentes, separa as enviadas pelo cliente e troca de aba', async () => {
    const page = await mount(TriageListPage);
    await page.respond('GET', '/triage/sessions', {
      data: [
        session(),
        session({
          id: 'triage-2',
          source: 'public',
          customer_id: null,
          vehicle_id: null,
          customer_name: null,
          vehicle_plate: null,
          contact: { name: 'João', phone: '71999990000' }
        })
      ],
      total: 2,
      page: 1,
      pageSize: 20
    });
    expect(page.text()).toContain('Marina Souza');
    expect(page.text()).toContain('João');
    expect(page.text()).toContain('Enviada pelo cliente');

    page.component.setStatus('archived');
    const request = page.http.expectOne((candidate) => candidate.url === '/api/v1/triage/sessions');
    expect(request.request.params.get('status')).toBe('archived');
    request.flush({ data: [], total: 0, page: 1, pageSize: 20 });
    await page.settle();
    expect(page.text()).toContain('Nada por aqui ainda.');

    const clipboard = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    await page.component.copyPublicLink();
    expect(clipboard.calls.mostRecent().args[0]).toMatch(/\/triagem\/oficina-demo$/);
  });

  it('mecânico consulta a fila mas não abre triagem nem vê o link público', async () => {
    const page = await mount(TriageListPage, { role: 'mechanic' });
    await page.respond('GET', '/triage/sessions', { data: [], total: 0, page: 1, pageSize: 20 });
    expect(page.component.canWrite).toBeFalse();
    expect(page.text()).not.toContain('Nova triagem');
    expect(page.text()).not.toContain('Copiar link');
  });

  it('wizard: veículo → sintomas → detalhes → revisão → salvar → converter em OS', async () => {
    const page = await mount(TriageWizardPage);
    await page.respond('GET', '/triage/catalog', CATALOG);
    expect(page.component.step()).toBe(0);
    expect(page.text()).toContain('Placa, nome ou telefone do cliente');

    page.component.pick(VEHICLE);
    await page.settle();
    expect(page.component.step()).toBe(1);
    expect(page.text()).toContain('Selecione ao menos um sintoma');

    const box = (page.fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.click();
    await page.settle();
    expect(page.component.symptoms()).toEqual([{ symptom_code: 'brake_noise', answers: {} }]);
    await page.click('Continuar');
    expect(page.text()).toContain('Quando acontece?');
    const select = (page.fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('select')!;
    select.value = 'Só a frio';
    select.dispatchEvent(new Event('change'));
    await page.click('Continuar');
    expect(page.text()).toContain('Confira o relato');
    expect(page.text()).toContain('Só a frio');
    await page.click('Voltar');
    expect(page.component.step()).toBe(2);
    await page.click('Continuar');

    page.component.notes = '  Barulho na descida ';
    await page.click('Salvar triagem');
    const sent = await page.respond('POST', '/triage/sessions', session());
    expect(sent).toEqual({
      customer_id: 'cust-1',
      vehicle_id: 'veh-1',
      reported_symptoms: [{ symptom_code: 'brake_noise', answers: { when: 'Só a frio' } }],
      free_form_notes: 'Barulho na descida'
    });
    expect(page.text()).toContain('Triagem salva.');

    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    await page.click('Abrir ordem de serviço agora');
    await page.respond('POST', '/triage/sessions/triage-1/convert', order());
    expect(navigate).toHaveBeenCalledWith(['/service-orders', 'order-1']);
  });

  it('wizard aberto pela ficha do veículo já pula a escolha; dá para trocar', async () => {
    const page = await mount(TriageWizardPage, { inputs: { vehicleId: 'veh-1' } });
    await page.respond('GET', '/triage/catalog', CATALOG);
    await page.respond('GET', '/vehicles/veh-1', VEHICLE);
    expect(page.component.step()).toBe(1);
    expect(page.text()).toContain('Marina Souza');
    await page.click('Trocar');
    expect(page.component.vehicle()).toBeNull();
    await page.component.save();
    page.http.expectNone((request) => request.method === 'POST');
  });

  it('triagem pendente com veículo: mostra o relato, converte ou arquiva', async () => {
    const page = await mount(TriageDetailPage, { inputs: { id: 'triage-1' } });
    await page.respond('GET', '/triage/catalog', CATALOG);
    await page.respond('GET', '/triage/sessions/triage-1', session());
    expect(page.text()).toContain('Chiado ao frear');
    expect(page.text()).toContain('Piora na descida');
    expect(page.component.isPending()).toBeTrue();

    const navigate = spyOn(page.router, 'navigate').and.resolveTo(true);
    await page.click('Abrir ordem de serviço');
    await page.respond('POST', '/triage/sessions/triage-1/convert', order());
    expect(navigate).toHaveBeenCalledWith(['/service-orders', 'order-1']);

    await page.click('Arquivar');
    await page.respond('POST', '/triage/sessions/triage-1/archive', session({ status: 'archived' }));
    expect(page.text()).toContain('Triagem arquivada.');
    expect(page.text()).not.toContain('Abrir ordem de serviço');
  });

  it('triagem enviada pelo cliente precisa ser vinculada a um veículo antes de virar OS', async () => {
    const page = await mount(TriageDetailPage, { inputs: { id: 'triage-2' } });
    await page.respond('GET', '/triage/catalog', CATALOG);
    await page.respond(
      'GET',
      '/triage/sessions/triage-2',
      session({ id: 'triage-2', source: 'public', customer_id: null, vehicle_id: null, contact: { name: 'João', phone: '71999990000', plate: 'ABC1D23' } })
    );
    expect(page.text()).toContain('Enviada por João');
    expect(page.text()).toContain('Vincule esta triagem');
    const convert = Array.from((page.fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Abrir ordem de serviço')
    );
    expect(convert?.disabled).toBeTrue();

    const linking = page.component.link(VEHICLE);
    expect(await page.respond('PATCH', '/triage/sessions/triage-2', session({ id: 'triage-2' }))).toEqual({ customer_id: 'cust-1', vehicle_id: 'veh-1' });
    await linking;
    expect(page.text()).not.toContain('Vincule esta triagem');
  });

  it('triagem já convertida aponta para a OS', async () => {
    const page = await mount(TriageDetailPage, { inputs: { id: 'triage-1' } });
    await page.respond('GET', '/triage/catalog', CATALOG);
    await page.respond('GET', '/triage/sessions/triage-1', session({ status: 'converted', service_order_id: 'order-1' }));
    expect(page.text()).toContain('já virou ordem de serviço');
  });
});

describe('triagem pública', () => {
  it('cliente informa contato, escolhe sintomas e envia sem login', async () => {
    const page = await mount(PublicTriagePage, { anonymous: true, inputs: { slug: 'oficina-demo' } });
    const intro = page.http.expectOne('/api/v1/triage/public/oficina-demo');
    expect(intro.request.headers.has('Authorization')).toBeFalse();
    intro.flush({ shop_name: 'Oficina Demo', catalog: CATALOG });
    await page.settle();
    expect(page.text()).toContain('Oficina Demo');

    page.component.contact = { name: 'João', phone: '(71) 99999-0000', plate: '', vehicle: 'Ford Ka' };
    page.component.step.set(1);
    page.component.symptoms.set([{ symptom_code: 'soft_pedal', answers: {} }]);
    await page.settle();
    await page.click('Continuar');
    expect(page.text()).toContain('Só mais alguns detalhes');

    await page.click('Enviar para a oficina');
    const sent = await page.respond('POST', '/triage/public/oficina-demo/sessions', { message: 'Informe um telefone com DDD.' }, 400);
    expect(sent).toEqual({
      contact: { name: 'João', phone: '(71) 99999-0000', plate: undefined, vehicle: 'Ford Ka' },
      reported_symptoms: [{ symptom_code: 'soft_pedal', answers: {} }],
      free_form_notes: undefined
    });
    expect(page.text()).toContain('Informe um telefone com DDD.');
    expect(page.component.done()).toBeFalse();

    await page.click('Enviar para a oficina');
    await page.respond('POST', '/triage/public/oficina-demo/sessions', { received: true });
    expect(page.text()).toContain('Recebemos o seu relato.');
  });

  it('link de oficina inexistente ou com o módulo desligado mostra aviso, sem detalhes', async () => {
    const page = await mount(PublicTriagePage, { anonymous: true, inputs: { slug: 'nao-existe' } });
    await page.respond('GET', '/triage/public/nao-existe', { message: 'Não encontrado' }, 404);
    expect(page.text()).toContain('Triagem indisponível');
    expect(page.text()).not.toContain('Não encontrado');
  });
});
