import { BadRequestException, GoneException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { actionEmail, MailService } from '../mail/mail.module';
import { AUTH_PROVIDER, AuthProvider } from './providers/auth-provider';

export type LinkPurpose = 'invite' | 'reset';

const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Senha provisória de quem entra por convite: nunca é mostrada nem enviada; a pessoa define a própria pelo link. */
export const temporaryPassword = () => randomBytes(24).toString('base64url');

/**
 * Convite e redefinição de senha por link, enviados pelo e-mail da plataforma (não pelo provedor de identidade).
 * Como os tokens do portal: só o hash vai ao banco, o link vale uma vez e por tempo limitado.
 */
@Injectable()
export class AccountLinksService {
  private readonly logger = new Logger(AccountLinksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailService,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Convite só existe com e-mail configurado: sem isso, quem cadastra precisa definir a senha na hora. */
  async assertCanInvite(): Promise<void> {
    if (!(await this.mail.configured())) {
      throw new BadRequestException('Defina uma senha para este usuário: o envio de convites por e-mail ainda não foi configurado no painel admin.');
    }
  }

  private async issue(userId: string, email: string, purpose: LinkPurpose): Promise<string> {
    const token = randomUUID();
    await this.db.admin(async (db) => {
      // um link novo aposenta os anteriores da mesma pessoa
      await db.exec(`update public.account_links set used_at = now() where user_id = $1 and used_at is null`, [userId]);
      await db.exec(
        `insert into public.account_links (token_hash, user_id, email, purpose, expires_at)
         values ($1, $2, $3, $4, now() + $5::interval)`,
        [hash(token), userId, email, purpose, purpose === 'invite' ? `${INVITE_DAYS} days` : `${RESET_MINUTES} minutes`]
      );
    });
    return `${this.env.portalBaseUrl}/definir-senha/${token}`;
  }

  async sendInvite(input: { userId: string; email: string; name: string; shopName: string }): Promise<void> {
    const url = await this.issue(input.userId, input.email, 'invite');
    await this.mail.send({
      to: input.email,
      subject: `Seu acesso ao PitStop — ${input.shopName}`,
      ...actionEmail({
        title: `Olá, ${input.name.split(' ')[0]}!`,
        intro: `Você foi cadastrado na oficina ${input.shopName} no PitStop. Para começar, crie a sua senha de acesso.`,
        action: 'Criar minha senha',
        url,
        footer: `O link vale por ${INVITE_DAYS} dias e só pode ser usado uma vez. Se você não esperava este e-mail, pode ignorá-lo.`
      })
    });
  }

  /** Pedido de redefinição. Não revela se o e-mail existe: qualquer endereço recebe a mesma resposta. */
  async requestReset(rawEmail: string): Promise<void> {
    if (!(await this.mail.configured())) {
      throw new ServiceUnavailableException('A recuperação de senha por e-mail não está disponível. Fale com o responsável pela sua oficina.');
    }
    const email = rawEmail.trim().toLowerCase();
    try {
      const member = await this.db.admin((db) =>
        db.maybeOne<{ user_id: string }>('select user_id from public.tenant_users where lower(email) = $1 and is_active', [email])
      );
      const isAdmin = member ? false : (await this.db.admin((db) => db.maybeOne('select 1 from public.super_admins where email = $1', [email]))) !== null;
      const userId = member?.user_id ?? (isAdmin ? await this.provider.findUserId(email) : null);
      if (!userId) return;
      const url = await this.issue(userId, email, 'reset');
      await this.mail.send({
        to: email,
        subject: 'Redefinição de senha do PitStop',
        ...actionEmail({
          title: 'Redefinir a senha',
          intro: 'Recebemos um pedido para redefinir a senha da sua conta no PitStop.',
          action: 'Escolher nova senha',
          url,
          footer: `O link vale por ${RESET_MINUTES} minutos. Se não foi você quem pediu, ignore este e-mail: a sua senha continua a mesma.`
        })
      });
    } catch (error) {
      this.logger.warn(`Pedido de redefinição não concluído: ${(error as Error).message}`);
    }
  }

  private async find(token: string): Promise<{ id: string; user_id: string; email: string; purpose: LinkPurpose }> {
    const link = await this.db.admin((db) =>
      db.maybeOne<{ id: string; user_id: string; email: string; purpose: LinkPurpose }>(
        `select id, user_id, email, purpose from public.account_links where token_hash = $1 and used_at is null and expires_at > now()`,
        [hash(token)]
      )
    );
    if (!link) throw new GoneException('Este link não vale mais. Peça um novo convite ou use "Esqueci minha senha".');
    return link;
  }

  async describe(token: string): Promise<{ email: string; purpose: LinkPurpose }> {
    const { email, purpose } = await this.find(token);
    return { email, purpose };
  }

  async redeem(token: string, password: string): Promise<{ email: string }> {
    const link = await this.find(token);
    await this.provider.setPassword(link.user_id, password);
    await this.db.admin((db) => db.exec('update public.account_links set used_at = now() where user_id = $1 and used_at is null', [link.user_id]));
    return { email: link.email };
  }
}
