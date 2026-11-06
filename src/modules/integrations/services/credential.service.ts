import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Credential } from '../../credentials/entities/credential.entity';
import { CredentialLog } from '../../credentials/entities/credentialLog.entity';
import {
  CredentialScopes,
  Scope,
} from '../../credentials/entities/scope.entity';
import { Account } from '../../onboarding/entities/account.entity';
import { Business } from '../../onboarding/entities/business.entity';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';

/** Scopes a merchant can grant today; Wallet as a service comes later. */
export const AVAILABLE_SCOPES = [CredentialScopes.Card];

export const SCOPE_LABELS: Record<CredentialScopes, string> = {
  [CredentialScopes.Card]: 'Cards',
  [CredentialScopes.WalletAsService]: 'Wallet as a service',
};

const MAX_IPS = 20;

export interface CredentialInput {
  name: string;
  scopes: CredentialScopes[];
  ips: string[];
}

export interface IssuedCredential {
  credential: Credential;
  clientId: string;
  clientSecret: string;
}

export type CredentialWithScopes = Credential & { scopes: CredentialScopes[] };

/** Normalises an address as Express reports it (IPv4-mapped IPv6 -> IPv4). */
export const normalizeIp = (ip?: string | null) =>
  (ip ?? '').replace(/^::ffff:/, '').trim();

/**
 * Splits the IP whitelist typed in the portal (one per line or comma
 * separated), checks each address and drops duplicates.
 */
export function parseIps(raw: unknown): { ips: string[]; error?: string } {
  const text = Array.isArray(raw)
    ? raw.join('\n')
    : typeof raw === 'string'
      ? raw
      : '';
  const ips = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((item) => normalizeIp(item))
        .filter(Boolean),
    ),
  ];
  const invalid = ips.find((ip) => !isIP(ip));
  if (invalid) return { ips, error: `${invalid} is not a valid IP address` };
  if (ips.length > MAX_IPS)
    return { ips, error: `Add at most ${MAX_IPS} IP addresses` };
  return { ips };
}

/**
 * API credentials (client id + secret) a business uses to get access tokens.
 * Both values are stored as HMAC-SHA256 with PRIVATE_KEY: the id stays
 * searchable, neither can be read back, so they are shown once when issued.
 */
@Injectable()
export class CredentialService extends EntityService<Credential> {
  constructor(
    @InjectRepository(Credential)
    private credentialRepository: Repository<Credential>,
    @InjectRepository(Scope) private scopeRepository: Repository<Scope>,
    @InjectRepository(CredentialLog)
    private logRepository: Repository<CredentialLog>,
    private readonly configService: ConfigService,
  ) {
    super();
    super.setRepository(this.credentialRepository);
  }

  private hash(value: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('PRIVATE_KEY'),
    )
      .update(value)
      .digest('hex');
  }

  private newSecret() {
    return `sas_${randomBytes(32).toString('base64url')}`;
  }

  /** Credentials of a business with their active scopes, newest first. */
  async list(businessId: number): Promise<CredentialWithScopes[]> {
    const credentials = await this.filterMany(
      { business: { id: businessId } },
      { order: { createdAt: 'DESC' } },
    );
    return this.withScopes(credentials);
  }

  async withScopes(credentials: Credential[]): Promise<CredentialWithScopes[]> {
    if (!credentials.length) return [];
    const scopes = await this.scopeRepository.find({
      where: {
        credential: { id: In(credentials.map((item) => item.id)) },
        active: true,
      },
      relations: { credential: true },
    });
    return credentials.map((credential) => ({
      ...credential,
      scopes: scopes
        .filter((scope) => scope.credential.id === credential.id)
        .map((scope) => scope.scope),
    }));
  }

  async findInBusiness(
    businessId: number,
    id: number,
  ): Promise<CredentialWithScopes | null> {
    const credential = await this.filter({ id, business: { id: businessId } });
    return credential ? (await this.withScopes([credential]))[0] : null;
  }

  /** Active credential behind a token, with its business, or null. */
  async findForApi(id: number): Promise<CredentialWithScopes | null> {
    const credential = await this.filter(
      { id, active: true },
      { relations: { business: true } },
    );
    return credential ? (await this.withScopes([credential]))[0] : null;
  }

  /**
   * The credential a client id and secret belong to, or null. The secret is
   * compared in constant time.
   */
  async verify(
    clientId: string,
    clientSecret: string,
  ): Promise<CredentialWithScopes | null> {
    const credential = await this.filter(
      { clientId: this.hash(clientId.trim()) },
      { relations: { business: true } },
    );
    if (!credential) return null;
    const expected = Buffer.from(credential.clientSecret);
    const received = Buffer.from(this.hash(clientSecret.trim()));
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      return null;
    return (await this.withScopes([credential]))[0];
  }

  async create(
    business: Business,
    actor: Account,
    input: CredentialInput,
  ): Promise<IssuedCredential> {
    this.assertScopes(input.scopes);
    const clientId = `sa_${randomBytes(16).toString('hex')}`;
    const clientSecret = this.newSecret();
    const credential = await this.save({
      business,
      name: input.name,
      clientId: this.hash(clientId),
      hint: clientId.slice(0, 11),
      clientSecret: this.hash(clientSecret),
      ips: input.ips,
      active: true,
    });
    await this.setScopes(credential, input.scopes);
    await this.log(
      credential,
      actor,
      'Created',
      `${input.name} created with ${this.describe(input)}`,
    );
    return { credential, clientId, clientSecret };
  }

  async updateDetails(
    credential: CredentialWithScopes,
    actor: Account,
    input: CredentialInput,
  ): Promise<void> {
    this.assertScopes(input.scopes);
    await this.update(
      { id: credential.id },
      { name: input.name, ips: input.ips },
    );
    await this.setScopes(credential, input.scopes);
    const changes = [
      input.name !== credential.name ? `renamed to ${input.name}` : '',
      input.ips.join(',') !== (credential.ips ?? []).join(',')
        ? `IP whitelist set to ${input.ips.join(', ') || 'none'}`
        : '',
      input.scopes.join(',') !== credential.scopes.join(',')
        ? `scopes set to ${this.scopeNames(input.scopes)}`
        : '',
    ].filter(Boolean);
    if (changes.length)
      await this.log(credential, actor, 'Updated', changes.join('; '));
  }

  /** New secret; the client id stays the same and the old secret stops working. */
  async rotate(credential: Credential, actor: Account): Promise<string> {
    const clientSecret = this.newSecret();
    await this.update(
      { id: credential.id },
      { clientSecret: this.hash(clientSecret) },
    );
    await this.log(
      credential,
      actor,
      'Secret rotated',
      'A new client secret was issued; the old one no longer works',
    );
    return clientSecret;
  }

  async setActive(
    credential: Credential,
    actor: Account,
    active: boolean,
  ): Promise<void> {
    await this.update({ id: credential.id }, { active });
    await this.log(
      credential,
      actor,
      active ? 'Activated' : 'Deactivated',
      active
        ? 'The key can get tokens and call the API again'
        : 'Tokens already issued stop working at once',
    );
  }

  /** Records use at most once a minute so busy keys don't write every call. */
  async touch(credential: Credential): Promise<void> {
    const last = credential.lastUsedAt
      ? new Date(credential.lastUsedAt).getTime()
      : 0;
    if (Date.now() - last > 60_000)
      await this.update({ id: credential.id }, { lastUsedAt: new Date() });
  }

  async logs(credentialId: number, limit = 10) {
    return this.logRepository.find({
      where: { credential: { id: credentialId } },
      relations: { account: { user: true } },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  scopeNames(scopes: CredentialScopes[]): string {
    return scopes.map((scope) => SCOPE_LABELS[scope]).join(', ') || 'none';
  }

  private describe(input: CredentialInput) {
    return `scopes ${this.scopeNames(input.scopes)} and ${
      input.ips.length
        ? `IP whitelist ${input.ips.join(', ')}`
        : 'no IP whitelist'
    }`;
  }

  private assertScopes(scopes: CredentialScopes[]) {
    if (!scopes.length)
      throw new FormError('Please fix the highlighted fields', {
        scopes: 'Choose at least one thing this key can do',
      });
    if (scopes.some((scope) => !AVAILABLE_SCOPES.includes(scope)))
      throw new FormError('Please fix the highlighted fields', {
        scopes: 'That scope is not available yet',
      });
  }

  private async setScopes(credential: Credential, scopes: CredentialScopes[]) {
    const existing = await this.scopeRepository.find({
      where: { credential: { id: credential.id } },
    });
    for (const scope of Object.values(CredentialScopes)) {
      const row = existing.find((item) => item.scope === scope);
      const wanted = scopes.includes(scope);
      if (row && row.active !== wanted)
        await this.scopeRepository.update({ id: row.id }, { active: wanted });
      else if (!row && wanted)
        await this.scopeRepository.save({ credential, scope, active: true });
    }
  }

  private async log(
    credential: Credential,
    actor: Account,
    action: string,
    description: string,
  ) {
    await this.logRepository.save({
      credential: { id: credential.id } as Credential,
      account: { id: actor.id } as Account,
      action,
      description,
    });
  }
}
