import { AuthorizationLevel } from '../../authorization/entities/permission.entity';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Country } from '../../settings/entities/country.entity';

export enum RequirementInput {
  FILE = 'File',
  TEXT = 'Text',
  NUMBER = 'Number',
}

@Entity()
export class Requirement extends CommonEntity {
  @ManyToOne(() => Country, (country: Country) => country.id, {
    onDelete: 'CASCADE',
  })
  country: Country;

  @Column({ enum: AuthorizationLevel })
  level: AuthorizationLevel;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  comment: string;

  @Column({ enum: RequirementInput })
  input: RequirementInput;

  @Column({ type: Boolean, default: true })
  required: boolean;
}
