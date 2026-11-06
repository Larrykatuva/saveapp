import { Column, Entity, Index } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { FileUrlTransformer } from '../../shared/transformers/file-url.transformer';

/** Where one-time codes are sent; SMS needs a verified phone number. */
export enum OtpChannel {
  Email = 'email',
  Sms = 'sms',
}

export enum SignInMethod {
  SignUp = 'SignUp',
  Google = 'Google',
  Apple = 'Apple',
  Facebook = 'Facebook',
}

@Entity()
export class User extends CommonEntity {
  // One user per email and per phone number: both identify the person
  @Column({ type: String })
  @Index({ unique: true })
  email: string;

  @Column({ type: String })
  @Index({ unique: true })
  phoneNumber: string;

  @Column({ type: String })
  fullName: string;

  // Profile photo: stored key, read back as a signed url (My account)
  @Column({ type: String, nullable: true, transformer: FileUrlTransformer })
  profile: string | null;

  @Column({ type: Boolean, default: false })
  emailVerified: boolean;

  @Column({ type: Boolean, default: false })
  verified: boolean;

  @Column({ type: Boolean, default: true })
  active: boolean;

  @Column({ type: Boolean, default: false })
  phoneVerified: boolean;

  // Chosen in My account once the phone is verified
  @Column({ type: 'varchar', enum: OtpChannel, default: OtpChannel.Email })
  otpChannel: OtpChannel;

  @Column({ type: String, nullable: true, select: false })
  password: string;

  @Column({ enum: SignInMethod, default: SignInMethod.SignUp })
  signInMethod: SignInMethod;

  // Apple's stable user id ("sub"): Apple may hide or relay the email
  @Column({ type: String, nullable: true, unique: true })
  appleId: string | null;
}
