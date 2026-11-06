import { Logger } from '@nestjs/common';
import { ValueTransformer } from 'typeorm';
import { getSignedUrl } from '@aws-sdk/cloudfront-signer';

/**
 * Prefix StorageService gives to every object stored on AWS
 * (see StorageService.getFileName).
 */
const AWS_KEY_PREFIX = 'AWS-';

/** Minimum time, in minutes, a returned url must remain valid. */
const MIN_VALID_MINUTES = 60;

/** Upper bound on cached signatures to keep memory flat. */
const CACHE_LIMIT = 10_000;

interface CachedUrl {
  url: string;
  // signature is served from cache until this time, after which it is
  // re-signed so callers always get at least MIN_VALID_MINUTES of validity
  reuseUntil: number;
}

/**
 * Turns stored AWS object keys into signed CloudFront urls. Signing is a
 * single synchronous RSA operation and every signature is reused until
 * it has less than MIN_VALID_MINUTES left, so hydrating a page of rows
 * costs a handful of map lookups.
 *
 * Environment:
 *  - AWS_CLOUDFRONT_URL              distribution url, e.g. https://d1.cloudfront.net
 *  - AWS_CLOUDFRONT_KEY_PAIR_ID      public key id registered on the distribution
 *  - AWS_CLOUDFRONT_PRIVATE_KEY      matching private key (PEM, "\n" escapes allowed)
 *  - AWS_CLOUDFRONT_URL_EXPIRY_MINUTES  signature lifetime, default 120
 */
class FileUrlSigner {
  private readonly logger = new Logger(FileUrlSigner.name);
  private readonly cache = new Map<string, CachedUrl>();
  private warned = false;

  private get baseUrl(): string {
    return (process.env.AWS_CLOUDFRONT_URL ?? '').replace(/\/+$/, '');
  }

  /**
   * Bucket url used when no CloudFront distribution is configured, so a
   * stored key is never handed to the browser as a bare, unloadable value.
   * (Water Solution addition; iniho returns the raw key in that case.)
   */
  private get bucketUrl(): string {
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;
    return bucket && region
      ? `https://${bucket}.s3.${region}.amazonaws.com`
      : '';
  }

  private get keyPairId(): string | undefined {
    return process.env.AWS_CLOUDFRONT_KEY_PAIR_ID;
  }

  private get privateKey(): string | undefined {
    return process.env.AWS_CLOUDFRONT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  }

  private get expiryMinutes(): number {
    const configured = Number(process.env.AWS_CLOUDFRONT_URL_EXPIRY_MINUTES);
    const minutes =
      Number.isFinite(configured) && configured > 0 ? configured : 120;
    // a signature must outlive the cache reuse window by the minimum validity
    return Math.max(minutes, MIN_VALID_MINUTES * 2);
  }

  isStoredKey(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(AWS_KEY_PREFIX);
  }

  /**
   * Public url of an object on the distribution, without a signature.
   */
  publicUrl(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}`;
  }

  /**
   * Signed url for a stored key. Values that are not stored keys (for
   * example http urls of externally hosted avatars) are returned as is.
   */
  sign(value: string | null | undefined): string | null | undefined {
    if (!this.isStoredKey(value)) return value;
    if (!this.baseUrl)
      return this.bucketUrl
        ? `${this.bucketUrl}/${encodeURIComponent(value)}`
        : value;

    const now = Date.now();
    const cached = this.cache.get(value);
    if (cached && cached.reuseUntil > now) return cached.url;

    const url = this.publicUrl(value);

    if (!this.keyPairId || !this.privateKey) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'AWS_CLOUDFRONT_KEY_PAIR_ID / AWS_CLOUDFRONT_PRIVATE_KEY are not set, serving unsigned CloudFront urls',
        );
      }
      return url;
    }

    const expiryMs = this.expiryMinutes * 60 * 1000;
    const signed = getSignedUrl({
      url: url,
      keyPairId: this.keyPairId,
      privateKey: this.privateKey,
      dateLessThan: new Date(now + expiryMs).toISOString(),
    });

    this.remember(value, {
      url: signed,
      reuseUntil: now + expiryMs - MIN_VALID_MINUTES * 60 * 1000,
    });

    return signed;
  }

  /**
   * Reverses sign(): a CloudFront url (signed or not) is reduced back to
   * the stored key so entities loaded from the database can be persisted
   * again without corrupting the column. Anything else passes through.
   */
  toKey(value: string | null | undefined): string | null | undefined {
    if (typeof value !== 'string') return value;
    const base = [this.baseUrl, this.bucketUrl].find(
      (url) => url && value.startsWith(`${url}/`),
    );
    if (!base) return value;

    try {
      const { pathname } = new URL(value);
      return decodeURIComponent(pathname.replace(/^\/+/, ''));
    } catch {
      return value;
    }
  }

  private remember(key: string, entry: CachedUrl): void {
    if (this.cache.size >= CACHE_LIMIT) {
      // Map iterates in insertion order, so this drops the oldest entry
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, entry);
  }
}

export const fileUrlSigner = new FileUrlSigner();

/**
 * Column transformer for a single stored file key. Reading from the
 * database yields a signed CloudFront url, writing accepts either a raw
 * key or a previously returned url.
 *
 * @example
 *   @Column({ type: String, transformer: FileUrlTransformer })
 *   logo: string;
 */
export const FileUrlTransformer: ValueTransformer = {
  to: (value: string | null | undefined) => fileUrlSigner.toKey(value),
  from: (value: string | null | undefined) => fileUrlSigner.sign(value),
};

/**
 * Column transformer for a jsonb array of objects that each carry a file
 * key under `field`, e.g. billing support documents `{ id, photo }`.
 *
 * @example
 *   @Column({ type: 'jsonb', transformer: fileUrlListTransformer('photo') })
 *   supportDocuments: BillDocument[];
 */
export const fileUrlListTransformer = <T extends object>(
  field: keyof T & string,
): ValueTransformer => {
  const apply = (
    list: T[] | null | undefined,
    convert: (value: string | null | undefined) => string | null | undefined,
  ): T[] | null | undefined => {
    if (!Array.isArray(list)) return list;
    return list.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const record = item as Record<string, unknown>;
      return {
        ...item,
        [field]: convert(record[field] as string | null | undefined),
      };
    });
  };

  return {
    to: (list: T[] | null | undefined) =>
      apply(list, (value) => fileUrlSigner.toKey(value)),
    from: (list: T[] | null | undefined) =>
      apply(list, (value) => fileUrlSigner.sign(value)),
  };
};
