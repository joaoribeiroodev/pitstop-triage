import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuthController } from './auth.controller';
import { JwtGuard, RolesGuard, SuperAdminGuard, TenantGuard } from './guards';
import { AUTH_PROVIDER } from './providers/auth-provider';
import { LocalAuthProvider } from './providers/local-auth.provider';
import { SupabaseAuthProvider } from './providers/supabase-auth.provider';
import { TokenService } from './token.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    {
      provide: AUTH_PROVIDER,
      inject: [ENV, DatabaseService, TokenService],
      useFactory: (env: Env, db: DatabaseService, tokens: TokenService) =>
        env.authProvider === 'local' ? new LocalAuthProvider(db, tokens) : new SupabaseAuthProvider(env)
    },
    JwtGuard,
    TenantGuard,
    RolesGuard,
    SuperAdminGuard
  ],
  exports: [TokenService, AUTH_PROVIDER, JwtGuard, TenantGuard, RolesGuard, SuperAdminGuard]
})
export class AuthModule {}
