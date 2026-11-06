import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm/repository/Repository';
import { EntityService } from '../../shared/services/entity.service';
import { User } from '../entities/user.entity';

@Injectable()
export class UserService extends EntityService<User> {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {
    super();
    super.setRepository(this.userRepository);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.filter({ email: email.trim().toLowerCase() });
  }

  /**
   * Loads a user together with the password hash, which is excluded from
   * normal queries (`select: false`).
   */
  async findWithPassword(
    where: { email: string } | { id: number },
  ): Promise<User | null> {
    const builder = this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password');
    if ('id' in where) builder.where('user.id = :id', { id: where.id });
    else
      builder.where('user.email = :email', {
        email: where.email.trim().toLowerCase(),
      });
    return builder.getOne();
  }
}
