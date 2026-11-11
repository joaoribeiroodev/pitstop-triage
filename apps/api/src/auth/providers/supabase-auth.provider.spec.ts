import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../../config/env';
import { SupabaseAuthProvider } from './supabase-auth.provider';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const SESSION = { access_token: 'acesso', refresh_token: 'renovacao', expires_in: 3600, token_type: 'bearer' };

/** Dublê do cliente Supabase: só os métodos de auth que o provedor usa. */
function fakeClient() {
  return {
    auth: {
      signInWithPassword: jest.fn(),
      refreshSession: jest.fn(),
      admin: {
        signOut: jest.fn().mockResolvedValue({ error: null }),
        createUser: jest.fn(),
        inviteUserByEmail: jest.fn(),
        listUsers: jest.fn().mockResolvedValue({ data: { users: [] } }),
        updateUserById: jest.fn().mockResolvedValue({ error: null }),
        deleteUser: jest.fn().mockResolvedValue({ error: null })
      }
    }
  };
}

describe('SupabaseAuthProvider', () => {
  const env = loadEnv({
    AUTH_PROVIDER: 'supabase',
    APP_JWT_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgres://localhost/pitstop',
    SUPABASE_URL: 'https://projeto.supabase.co/',
    SUPABASE_ANON_KEY: 'chave-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'chave-service-role'
  });
  let admin: ReturnType<typeof fakeClient>;
  let anon: ReturnType<typeof fakeClient>;
  let provider: SupabaseAuthProvider;

  beforeEach(() => {
    admin = fakeClient();
    anon = fakeClient();
    (createClient as jest.Mock).mockReset().mockImplementation((_url: string, key: string) => (key === 'chave-service-role' ? admin : anon));
    provider = new SupabaseAuthProvider(env);
  });

  it('usa a service_role só no cliente admin e a chave anon no login, sem persistir sessão', async () => {
    anon.auth.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null });
    await expect(provider.signIn('dono@oficina.com', 'senha')).resolves.toEqual({ access_token: 'acesso', refresh_token: 'renovacao', expires_in: 3600 });
    const calls = (createClient as jest.Mock).mock.calls;
    expect(calls.map(([url, key]) => [url, key])).toEqual([
      ['https://projeto.supabase.co', 'chave-service-role'],
      ['https://projeto.supabase.co', 'chave-anon']
    ]);
    expect(calls[0][2]).toEqual({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(admin.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('login e refresh inválidos viram 401 sem repassar o erro do provedor', async () => {
    anon.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } });
    await expect(provider.signIn('a@b.c', 'errada')).rejects.toThrow(new UnauthorizedException('E-mail ou senha inválidos.'));
    anon.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    await expect(provider.refresh('velho')).rejects.toBeInstanceOf(UnauthorizedException);
    anon.auth.refreshSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    await expect(provider.refresh('bom')).resolves.toMatchObject({ access_token: 'acesso' });
    expect(anon.auth.refreshSession).toHaveBeenLastCalledWith({ refresh_token: 'bom' });
  });

  it('logout nunca falha, mesmo com o provedor fora do ar', async () => {
    admin.auth.admin.signOut.mockRejectedValue(new Error('rede'));
    await expect(provider.signOut('token')).resolves.toBeUndefined();
  });

  it('cria usuário com senha já confirmado e com tenant_id/role no app_metadata', async () => {
    admin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    const appMetadata = { tenant_id: 't-1', role: 'owner' };
    await expect(provider.createUser({ email: 'dono@oficina.com', password: 'senha-forte', appMetadata })).resolves.toEqual({ id: 'u-1', invited: false });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'dono@oficina.com',
      password: 'senha-forte',
      email_confirm: true,
      app_metadata: appMetadata
    });
  });

  it('sem senha, convida por e-mail e sincroniza as permissões em seguida', async () => {
    admin.auth.admin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null });
    await expect(provider.createUser({ email: 'mec@oficina.com', appMetadata: { tenant_id: 't-1', role: 'mechanic' } })).resolves.toEqual({
      id: 'u-2',
      invited: true
    });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith('u-2', { app_metadata: { tenant_id: 't-1', role: 'mechanic' } });
  });

  it('e-mail já existente é adotado (com permissões atualizadas) em vez de falhar', async () => {
    admin.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: 'already registered' } });
    admin.auth.admin.listUsers.mockResolvedValue({ data: { users: [{ id: 'u-9', email: 'Dono@Oficina.com' }] } });
    await expect(
      provider.createUser({ email: 'dono@oficina.com', password: 'senha-forte', appMetadata: { tenant_id: 't-2', role: 'owner' } })
    ).resolves.toEqual({
      id: 'u-9',
      invited: false
    });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith('u-9', { app_metadata: { tenant_id: 't-2', role: 'owner' } });

    admin.auth.admin.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'smtp fora do ar' } });
    admin.auth.admin.listUsers.mockResolvedValue({ data: { users: [] } });
    await expect(provider.createUser({ email: 'novo@oficina.com', appMetadata: {} })).rejects.toThrow(/smtp fora do ar/);
  });

  it('falhas do provedor em permissões, senha e exclusão viram 502 com o motivo', async () => {
    admin.auth.admin.updateUserById.mockResolvedValue({ error: { message: 'indisponível' } });
    await expect(provider.updateAppMetadata('u-1', { role: 'manager' })).rejects.toBeInstanceOf(BadGatewayException);
    await expect(provider.setPassword('u-1', 'nova-senha')).rejects.toThrow(/indisponível/);
    admin.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'indisponível' } });
    await expect(provider.deleteUser('u-1')).rejects.toBeInstanceOf(BadGatewayException);

    admin.auth.admin.updateUserById.mockResolvedValue({ error: null });
    admin.auth.admin.deleteUser.mockResolvedValue({ error: null });
    await expect(provider.setPassword('u-1', 'nova-senha')).resolves.toBeUndefined();
    await expect(provider.deleteUser('u-1')).resolves.toBeUndefined();
    expect(admin.auth.admin.updateUserById).toHaveBeenLastCalledWith('u-1', { password: 'nova-senha' });
  });
});
