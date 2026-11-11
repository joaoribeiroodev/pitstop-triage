import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { JwtGuard, RolesGuard, SuperAdminGuard, TenantGuard } from './auth/guards';
import { ShopCatalogModule } from './catalog/catalog.module';
import { Public } from './common/decorators';
import { AppThrottlerGuard } from './common/throttler.guard';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ENV, Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { DatabaseService } from './database/database.service';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { PortalModule } from './portal/portal.module';
import { QuotesModule } from './quotes/quotes.module';
import { ServiceOrdersModule } from './service-orders/service-orders.module';
import { TenantsModule } from './tenants/tenants.module';
import { TriageModule } from './triage/triage.module';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async health() {
    await this.db.admin((db) => db.one('select 1 as ok'));
    return { status: 'ok' };
  }
}

/** Dados públicos da política de privacidade: o que muda por ambiente sem exigir novo build do frontend. */
@Controller('privacy')
export class PrivacyController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Public()
  @Get()
  privacy() {
    return { policy_version: this.env.privacyPolicyVersion, dpo_email: this.env.dpoContactEmail || null };
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        genReqId: (request) => (request.headers['x-request-id'] as string) ?? randomUUID(),
        // Nunca registrar credenciais nem o token do portal (que faz parte da URL).
        redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
        serializers: {
          req: (request: { id: string; method: string; url: string }) => ({
            id: request.id,
            method: request.method,
            url: request.url.replace(/(\/portal\/)[^/?]+/, '$1:token')
          })
        },
        autoLogging: { ignore: (request) => request.url === '/api/v1/health' }
      }
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.THROTTLE_DISABLED === 'true'
    }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    CustomersModule,
    VehiclesModule,
    ShopCatalogModule,
    TriageModule,
    DiagnosticsModule,
    ServiceOrdersModule,
    QuotesModule,
    PortalModule,
    DashboardModule,
    AdminModule
  ],
  controllers: [HealthController, PrivacyController],
  providers: [
    // A ordem importa: limite de taxa → JWT → super admin → tenant → papéis/feature flags.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtGuard },
    { provide: APP_GUARD, useExisting: SuperAdminGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
    { provide: APP_GUARD, useExisting: RolesGuard }
  ]
})
export class AppModule {}
