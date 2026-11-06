import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan } from 'typeorm';
import { Repository } from 'typeorm/repository/Repository';
import { EntityService } from '../../shared/services/entity.service';
import { Code, Purpose } from '../entities/code.entity';
import { User } from '../entities/user.entity';

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/**
 * One-time numeric codes sent by email. Codes are scoped to a user and a
 * purpose, only the latest one is valid, and only a hash is stored.
 */
@Injectable()
export class CodeService extends EntityService<Code> {
  constructor(
    @InjectRepository(Code) private codeRepository: Repository<Code>,
  ) {
    super();
    super.setRepository(this.codeRepository);
  }

  /** Issues a fresh 6-digit code and invalidates any earlier unused ones. */
  async issue(user: User, purpose: Purpose, ttlMinutes = 10): Promise<string> {
    await this.codeRepository.update(
      { user: { id: user.id }, purpose, used: false },
      { used: true },
    );
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.save({
      user,
      purpose,
      code: hash(code),
      expiry: new Date(Date.now() + ttlMinutes * 60_000),
    });
    return code;
  }

  /** Consumes the code if it is the user's current, unexpired one. */
  async consume(user: User, purpose: Purpose, code: string): Promise<boolean> {
    const current = await this.filter(
      {
        user: { id: user.id },
        purpose,
        used: false,
        expiry: MoreThan(new Date()),
      },
      { order: { createdAt: 'DESC' } },
    );
    if (!current) return false;

    const expected = Buffer.from(current.code);
    const received = Buffer.from(hash(code));
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      return false;

    await this.codeRepository.update({ id: current.id }, { used: true });
    return true;
  }
}
