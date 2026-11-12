import { TestBed } from '@angular/core/testing';
import { ToastService } from '@front/core';
import { DayPipe, localDay, toDate } from '@front/format';
import type { TenantUser } from '@pitstop/shared-types';
import { mount } from '../../testing/harness';
import { VehicleFormComponent } from '../ui/vehicle-form.component';
import { ForgotPasswordPage, SetPasswordPage } from './account.page';
import { UsersPage } from './settings.page';

describe('acesso por link', () => {
  it('"esqueci minha senha" envia o pedido e mostra a mesma confirmação para qualquer e-mail', async () => {
    const page = await mount(ForgotPasswordPage, { anonymous: true });
    page.component.email = ' Dono@Oficina.com ';
    let sending = page.component.submit();
    expect(await page.respond('POST', '/auth/password-reset', { message: 'A recuperação de senha por e-mail não está disponível.' }, 503)).toEqual({
      email: 'dono@oficina.com'
    });
    await sending;
    expect(page.text()).toContain('não está disponível');

    sending = page.component.submit();
    await page.respond('POST', '/auth/password-reset', {}, 204);
    await sending;
    await page.settle();
    expect(page.text()).toContain('Se houver uma conta com este e-mail');
  });

  it('o link do convite deixa a pessoa criar a senha; link usado ou vencido explica o que fazer', async () => {
    const page = await mount(SetPasswordPage, { anonymous: true, inputs: { token: 'tok-1' } });
    await page.respond('GET', '/auth/links/tok-1', { email: 'jorge@oficina.com', purpose: 'invite' });
    expect(page.text()).toContain('Crie a sua senha');
    expect(page.text()).toContain('jorge@oficina.com');

    page.component.password = 'senha-do-jorge';
    page.component.confirm = 'outra-coisa';
    await page.component.submit();
    expect(page.component.error()).toContain('iguais');

    page.component.confirm = 'senha-do-jorge';
    let saving = page.component.submit();
    await page.respond('POST', '/auth/links/tok-1', { message: 'Este link não vale mais.' }, 410);
    await saving;
    expect(page.component.error()).toContain('não vale mais');
    saving = page.component.submit();
    expect(await page.respond('POST', '/auth/links/tok-1', { email: 'jorge@oficina.com' })).toEqual({ password: 'senha-do-jorge' });
    await saving;
    await page.settle();
    expect(page.text()).toContain('Senha definida');

    const reset = await mount(SetPasswordPage, { anonymous: true, inputs: { token: 'tok-2' } });
    await reset.respond('GET', '/auth/links/tok-2', { email: 'a@b.c', purpose: 'reset' });
    expect(reset.text()).toContain('Nova senha');

    const gone = await mount(SetPasswordPage, { anonymous: true, inputs: { token: 'tok-3' } });
    await gone.respond('GET', '/auth/links/tok-3', { message: 'x' }, 410);
    expect(gone.text()).toContain('já foi usado ou expirou');
    expect(gone.text()).toContain('Pedir um novo link');
  });

  it('o responsável reenvia o link de acesso a um usuário', async () => {
    const user: TenantUser = {
      id: 'm-2',
      tenant_id: 't',
      user_id: 'u-2',
      role: 'mechanic',
      full_name: 'Seu Jorge',
      email: 'jorge@oficina.com',
      is_active: true,
      created_at: ''
    };
    const page = await mount(UsersPage, { role: 'owner' });
    await page.respond('GET', '/users', [user, { ...user, id: 'm-3', full_name: 'Inativa', is_active: false }]);
    expect((page.fixture.nativeElement as HTMLElement).querySelectorAll('[aria-label^="Enviar link de acesso"]').length).toBe(1);
    await page.click('Enviar link de acesso');
    await page.respond('POST', '/users/m-2/invite', {}, 204);
    expect(TestBed.inject(ToastService).items().at(-1)?.text).toContain('jorge@oficina.com');
  });
});

describe('datas de calendário', () => {
  it('uma data sem hora aparece no próprio dia, não no anterior', () => {
    expect(new DayPipe().transform('2026-11-13')).toBe('13/11/2026');
    expect(new DayPipe().transform(null)).toBe('—');
    expect(localDay('2026-11-13')).toBe('2026-11-13');
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(toDate('2026-11-13T12:00:00.000Z').toISOString()).toBe('2026-11-13T12:00:00.000Z');
  });
});

describe('tabela FIPE no cadastro do veículo', () => {
  it('marca, modelo e ano escolhidos preenchem o formulário e mostram o valor de referência', async () => {
    const page = await mount(VehicleFormComponent, { inputs: { customerId: 'cust-1', initialPlate: 'ABC1D23' } });
    const details = (page.fixture.nativeElement as HTMLElement).querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await page.respond('GET', '/fipe/cars/brands', [{ code: '22', name: 'Ford' }]);
    expect(page.component.fipeBrands()).toEqual([{ code: '22', name: 'Ford' }]);
    // reabrir não consulta de novo
    details.dispatchEvent(new Event('toggle'));

    const brand = page.component.setFipeBrand('22');
    await page.respond('GET', '/fipe/cars/brands/22/models', [{ code: '1234', name: 'Ka 1.0' }]);
    await brand;
    const model = page.component.setFipeModel('1234');
    await page.respond('GET', '/fipe/cars/brands/22/models/1234/years', [{ code: '2019-1', name: '2019 Gasolina' }]);
    await model;
    const year = page.component.setFipeYear('2019-1');
    await page.respond('GET', '/fipe/cars/brands/22/models/1234/years/2019-1', {
      brand: 'Ford',
      model: 'Ka 1.0',
      year: 2019,
      fuel: 'gasolina',
      fipe_code: '003325-1',
      price: 16421,
      reference_month: 'novembro de 2026'
    });
    await year;
    await page.settle();
    expect(page.component.form).toEqual(jasmine.objectContaining({ plate: 'ABC1D23', brand: 'Ford', model: 'Ka 1.0', year: 2019, fuel_type: 'Gasolina' }));
    expect(page.text()).toContain('Valor de referência FIPE');
    expect(page.text()).toContain('16.421,00');
    expect(page.text()).toContain('novembro de 2026');
    expect(page.component.hint()).toContain('tabela FIPE');

    // zero km (ano 32000) e combustível desconhecido não sobrescrevem o que já está no formulário
    const zero = page.component.setFipeYear('32000-1');
    await page.respond('GET', '/fipe/cars/brands/22/models/1234/years/32000-1', {
      brand: null,
      model: null,
      year: 32000,
      fuel: 'Outro',
      fipe_code: null,
      price: null,
      reference_month: null
    });
    await zero;
    await page.settle();
    expect(page.component.form).toEqual(jasmine.objectContaining({ brand: 'Ford', year: 2019, fuel_type: 'Gasolina' }));
    expect(page.text()).toContain('não informado');
  });

  it('FIPE fora do ar mostra o aviso e o cadastro segue manual; trocar o tipo recomeça a busca', async () => {
    const page = await mount(VehicleFormComponent, { inputs: { customerId: 'cust-1' } });
    const switching = page.component.setFipeType('motorcycles');
    await page.respond('GET', '/fipe/motorcycles/brands', { message: 'Tabela FIPE indisponível no momento. Preencha os dados manualmente.' }, 503);
    await switching;
    expect(page.component.fipeError()).toContain('manualmente');
    expect(page.component.fipeBrands()).toEqual([]);
    expect(TestBed.inject(ToastService).items()).toEqual([]);
    const year = page.component.setFipeYear('2019-1');
    await page.respond('GET', '/fipe/motorcycles/brands//models//years/2019-1', { message: 'x' }, 503);
    await year;
    expect(page.component.fipePrice()).toBeNull();
  });
});
