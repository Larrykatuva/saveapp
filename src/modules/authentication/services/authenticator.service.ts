import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';
import { Authenticator } from '../entities/authenticator.entity';
import { User } from '../entities/user.entity';
import { AttemptService } from './attempt.service';

const ISSUER = 'SaveApp';
const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept the previous and next step too, for clock drift
const WINDOW = 1;
const RECOVERY_CODES = 8;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer: Buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
};

const base32Decode = (text: string) => {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** The 6-digit code for a secret at a 30-second step (RFC 6238, SHA-1). */
const codeAt = (secret: Buffer, step: number) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export interface AuthenticatorSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/**
 * Two-step verification with an authenticator app (Google Authenticator,
 * Microsoft Authenticator, 1Password...). The secret is stored encrypted,
 * a code can't be used twice, failures are throttled, and eight one-time
 * recovery codes (stored hashed) cover a lost phone.
 */
@Injectable()
export class AuthenticatorService extends EntityService<Authenticator> {
  constructor(
    @InjectRepository(Authenticator)
    private authenticatorRepository: Repository<Authenticator>,
    private readonly attemptService: AttemptService,
    private readonly configService: ConfigService,
  ) {
    super();
    super.setRepository(this.authenticatorRepository);
  }

  /* ---------------------------- Secrets ----------------------------- */

  private get key(): Buffer {
    return createHash('sha256')
      .update(
        `authenticator:${this.configService.getOrThrow<string>('PRIVATE_KEY')}`,
      )
      .digest();
  }

  private encrypt(text: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString('base64'))
      .join('.');
  }

  private decrypt(stored: string): string {
    const [iv, tag, data] = stored
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  /** The row with its secret and recovery codes, which are not selected by default. */
  private async full(userId: number): Promise<Authenticator | null> {
    return this.authenticatorRepository
      .createQueryBuilder('authenticator')
      .addSelect(['authenticator.secret', 'authenticator.recoveryCodes'])
      .where('authenticator."userId" = :userId', { userId })
      .getOne();
  }

  /* ----------------------------- Status ----------------------------- */

  async enabledAt(userId: number): Promise<Date | null> {
    const row = await this.filter({ user: { id: userId } });
    return row?.enabledAt ?? null;
  }

  async isEnabled(userId: number): Promise<boolean> {
    return Boolean(await this.enabledAt(userId));
  }

  async recoveryCodesLeft(userId: number): Promise<number> {
    return (await this.full(userId))?.recoveryCodes?.length ?? 0;
  }

  /* ------------------------------ Setup ----------------------------- */

  /** Starts (or restarts) setup with a fresh secret; sign in is unchanged until confirmed. */
  async beginSetup(user: User): Promise<AuthenticatorSetup> {
    if (await this.isEnabled(user.id))
      throw new FormError('Two-step verification is already on');
    const secret = base32Encode(randomBytes(20));
    const existing = await this.filter({ user: { id: user.id } });
    const values = {
      secret: this.encrypt(secret),
      enabledAt: null,
      recoveryCodes: [],
      lastStep: '0',
    };
    if (existing) await this.update({ id: existing.id }, values);
    else await this.save({ user: { id: user.id } as User, ...values });
    return this.setupDetails(user, secret);
  }

  /** QR code and manual key for the pending setup. */
  async pendingSetup(user: User): Promise<AuthenticatorSetup | null> {
    const row = await this.full(user.id);
    if (!row || row.enabledAt) return null;
    return this.setupDetails(user, this.decrypt(row.secret));
  }

  private async setupDetails(
    user: User,
    secret: string,
  ): Promise<AuthenticatorSetup> {
    const label = encodeURIComponent(`${ISSUER}:${user.email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
    return {
      secret: secret.replace(/(.{4})/g, '$1 ').trim(),
      otpauthUrl,
      qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }),
    };
  }

  /** Confirms setup with a code from the app; returns the recovery codes. */
  async confirmSetup(user: User, code: string): Promise<string[]> {
    const row = await this.full(user.id);
    if (!row) throw new FormError('Start setup again');
    if (row.enabledAt)
      throw new FormError('Two-step verification is already on');
    const step = this.matchStep(this.decrypt(row.secret), code, 0);
    if (step === null)
      throw new FormError('Please fix the highlighted fields', {
        code: 'That code is not right. Check the time on your phone and try the newest code.',
      });
    const codes = this.newRecoveryCodes();
    await this.update(
      { id: row.id },
      {
        enabledAt: new Date(),
        lastStep: String(step),
        recoveryCodes: codes.map((item) => sha256(item)),
      },
    );
    return codes;
  }

  /* --------------------------- Verification -------------------------- */

  /**
   * Checks a code from the app or an unused recovery code. Throttled per
   * user; a used code or recovery code can't be used again.
   */
  async verify(userId: number, input: string): Promise<'app' | 'recovery'> {
    const key = `2fa:${userId}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError('Too many wrong codes. Try again in 15 minutes');
    const row = await this.full(userId);
    if (!row?.enabledAt)
      throw new FormError('Two-step verification is not on for this account');

    const value = input.replace(/\s+/g, '');
    if (/^\d{6}$/.test(value)) {
      const step = this.matchStep(
        this.decrypt(row.secret),
        value,
        Number(row.lastStep),
      );
      if (step !== null) {
        await this.update({ id: row.id }, { lastStep: String(step) });
        await this.attemptService.clear(key);
        return 'app';
      }
    } else {
      const hash = sha256(value.toLowerCase());
      const codes = row.recoveryCodes ?? [];
      const match = codes.find((item) => sameText(item, hash));
      if (match) {
        await this.update(
          { id: row.id },
          { recoveryCodes: codes.filter((item) => item !== match) },
        );
        await this.attemptService.clear(key);
        return 'recovery';
      }
    }
    const left =
      MAX_ATTEMPTS - (await this.attemptService.fail(key, LOCKOUT_MS));
    throw new FormError('That code is not right', {
      code:
        left > 0
          ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left`
          : 'Too many attempts',
    });
  }

  /** New recovery codes (the old ones stop working); needs a current code. */
  async regenerateRecoveryCodes(user: User, code: string): Promise<string[]> {
    await this.verify(user.id, code);
    const codes = this.newRecoveryCodes();
    const row = await this.filter({ user: { id: user.id } });
    if (row)
      await this.update(
        { id: row.id },
        { recoveryCodes: codes.map((item) => sha256(item)) },
      );
    return codes;
  }

  /** Turns two-step verification off; the caller checks the password first. */
  async disable(user: User, code: string): Promise<void> {
    await this.verify(user.id, code);
    await this.delete({ user: { id: user.id } });
  }

  /** The step a code belongs to (within the drift window and after `after`), or null. */
  private matchStep(secret: string, code: string, after: number) {
    const value = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(value)) return null;
    const key = base32Decode(secret);
    const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
    for (let offset = -WINDOW; offset <= WINDOW; offset++) {
      const step = now + offset;
      if (step > after && sameText(codeAt(key, step), value)) return step;
    }
    return null;
  }

  private newRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODES }, () => {
      const raw = randomBytes(5).toString('hex');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
  }
}
