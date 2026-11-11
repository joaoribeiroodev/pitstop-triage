import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { TenantRole } from '@pitstop/shared-types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { AUTH_PROVIDER, AuthProvider } from '../src/auth/providers/auth-provider';
import { DatabaseService } from '../src/database/database.service';

export const PASSWORD = 'senha-forte-123';
let sequence = 0;
export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence += 1)}`;

export interface TestTenant {
  id: string;
  slug: string;
  ownerEmail: string;
  ownerToken: string;
}

export class Harness {
  app: INestApplication;
  db: DatabaseService;
  auth: AuthProvider;
  adminToken: string;
  adminEmail: string;

  static async start(): Promise<Harness> {
    const harness = new Harness();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    harness.app = moduleRef.createNestApplication();
    setupApp(harness.app);
    await harness.app.init();
    harness.db = harness.app.get(DatabaseService);
    harness.auth = harness.app.get<AuthProvider>(AUTH_PROVIDER);

    harness.adminEmail = `${unique('root')}@pitstop.test`;
    await harness.auth.createUser({ email: harness.adminEmail, password: PASSWORD, appMetadata: { is_super_admin: true } });
    await harness.db.admin((db) => db.exec('insert into public.super_admins (email) values ($1)', [harness.adminEmail]));
    harness.adminToken = await harness.login(harness.adminEmail);
    return harness;
  }

  stop(): Promise<void> {
    return this.app.close();
  }

  get http() {
    return request(this.app.getHttpServer());
  }

  api(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token?: string) {
    const call = this.http[method](`/api/v1${path}`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  }

  async login(email: string, password = PASSWORD): Promise<string> {
    const response = await this.api('post', '/auth/login').send({ email, password }).expect(200);
    return response.body.access_token;
  }

  async createTenant(overrides: Record<string, unknown> = {}): Promise<TestTenant> {
    const slug = unique('oficina');
    const ownerEmail = `${slug}@oficina.test`;
    const response = await this.api('post', '/admin/tenants', this.adminToken)
      .send({ name: `Oficina ${slug}`, slug, plan: 'pro', owner_email: ownerEmail, owner_name: 'Dona da Oficina', owner_password: PASSWORD, ...overrides })
      .expect(201);
    return { id: response.body.id, slug, ownerEmail, ownerToken: await this.login(ownerEmail) };
  }

  async createUser(tenant: TestTenant, role: TenantRole): Promise<{ id: string; email: string; token: string }> {
    const email = `${unique(role)}@oficina.test`;
    const response = await this.api('post', '/users', tenant.ownerToken)
      .send({ email, full_name: `Pessoa ${role}`, role, password: PASSWORD })
      .expect(201);
    return { id: response.body.id, email, token: await this.login(email) };
  }

  async createCustomerWithVehicle(token: string, plate: string, extra: Record<string, unknown> = {}) {
    const customer = await this.api('post', '/customers', token)
      .send({ name: `Cliente ${plate}`, phone: '(71) 98888-7777' })
      .expect(201);
    const vehicle = await this.api('post', '/vehicles', token)
      .send({ customer_id: customer.body.id, plate, brand: 'Ford', model: 'Ka', year: 2019, ...extra })
      .expect(201);
    return { customer: customer.body, vehicle: vehicle.body };
  }
}
