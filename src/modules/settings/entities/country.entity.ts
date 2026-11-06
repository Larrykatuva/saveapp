import { Column, Entity } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { FileUrlTransformer } from '../../shared/transformers/file-url.transformer';

@Entity()
export class Country extends CommonEntity {
  @Column({ type: String })
  name: string;

  @Column({ type: String })
  code: string;

  // Uploaded flag (S3 key, served as a CloudFront url) or the standard flag url
  @Column({ type: String, transformer: FileUrlTransformer })
  logo: string;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
