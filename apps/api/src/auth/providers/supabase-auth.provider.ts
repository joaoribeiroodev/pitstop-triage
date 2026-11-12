import { BadGatewayException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { SessionTokens } from '@pitstop/shared-types';
import { ENV, Env } from '../../config/env';
import type { AppMetadata, AuthProvider, CreateUserInput } from './auth-provider';

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

@Injectable()
export class SupabaseAuthProvider implements AuthProvider {
  private readonly adminClient: SupabaseClient;

  constructor(@Inject(ENV) private readonly env: Env) {
    // service_role: existe apenas aqui, no backend.
    this.adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, NO_SESSION);
  }

  /** Cliente descartável com a chave anon: login/refresh não podem contaminar o cliente admin. */
  private anonClient(): SupabaseClient {
    return createClient(this.env.supabaseUrl, this.env.supabaseAnonKey, NO_SESSION);
  }

  async signIn(email: string, password: string): Promise<SessionTokens> {
    const { data, error } = await this.anonClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new UnauthorizedException('E-mail ou senha inválidos.');
    return toTokens(data.session);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const { data, error } = await this.anonClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    return toTokens(data.session);
  }

  async signOut(accessToken: string): Promise<void> {
    await this.adminClient.auth.admin.signOut(accessToken).catch(() => undefined);
  }

  async createUser(input: CreateUserInput): Promise<{ id: string; invited: boolean }> {
    const admin = this.adminClient.auth.admin;
    if (input.password) {
      const { data, error } = await admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        app_metadata: input.appMetadata
      });
      if (!error && data.user) return { id: data.user.id, invited: false };
      return { id: await this.adoptExisting(input, error?.message), invited: false };
    }
    const { data, error } = await admin.inviteUserByEmail(input.email);
    if (error || !data.user) return { id: await this.adoptExisting(input, error?.message), invited: false };
    await this.updateAppMetadata(data.user.id, input.appMetadata);
    return { id: data.user.id, invited: true };
  }

  async findUserId(email: string): Promise<string | null> {
    const { data } = await this.adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    return data?.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  }

  private async adoptExisting(input: CreateUserInput, reason?: string): Promise<string> {
    const existingId = await this.findUserId(input.email);
    const existing = existingId ? { id: existingId } : null;
    if (!existing) throw new BadGatewayException(`Não foi possível criar o usuário no provedor de identidade: ${reason ?? 'erro desconhecido'}`);
    await this.updateAppMetadata(existing.id, input.appMetadata);
    return existing.id;
  }

  async updateAppMetadata(userId: string, appMetadata: AppMetadata): Promise<void> {
    const { error } = await this.adminClient.auth.admin.updateUserById(userId, { app_metadata: appMetadata });
    if (error) throw new BadGatewayException(`Falha ao sincronizar permissões do usuário: ${error.message}`);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const { error } = await this.adminClient.auth.admin.updateUserById(userId, { password, email_confirm: true });
    // Definir a senha também confirma o e-mail: quem chegou pelo link provou que é dono do endereço.
    if (error) throw new BadGatewayException(`Falha ao definir a senha: ${error.message}`);
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.adminClient.auth.admin.deleteUser(userId);
    if (error) throw new BadGatewayException(`Falha ao remover o usuário: ${error.message}`);
  }
}

function toTokens(session: { access_token: string; refresh_token: string; expires_in: number }): SessionTokens {
  return { access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in };
}
