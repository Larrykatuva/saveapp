import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { fileUrlSigner } from '../transformers/file-url.transformer';

export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
};
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * S3 storage, mirroring the housing (iniho) project: objects get an
 * unguessable `AWS-…` key, only the key is stored in the database, and
 * FileUrlTransformer turns it into a (signed) CloudFront url when read.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly cloudProvider: string;
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly awsRegion: string;

  constructor(private configService: ConfigService) {
    this.cloudProvider =
      this.configService.get<string>('CLOUD_PROVIDER') ?? 'AWS';
    if (this.cloudProvider !== 'AWS')
      throw new Error(`Unsupported CLOUD_PROVIDER: ${this.cloudProvider}`);

    this.bucketName =
      this.configService.getOrThrow<string>('AWS_S3_BUCKET_NAME');
    this.awsRegion = this.configService.getOrThrow<string>('AWS_REGION');
    this.s3 = new S3Client({
      region: this.awsRegion,
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  getFileName(filename: string): string {
    const datePart = new Date().toISOString().replace(/[:.]/g, '-');
    return `${this.cloudProvider}-${datePart}-${filename}`;
  }

  /**
   * Unguessable object key that keeps the provider prefix expected by
   * FileUrlTransformer; only the original extension is kept.
   */
  getSecureFileName(filename: string): string {
    const extension = extname(filename ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    const token = randomBytes(32).toString('hex');
    return `${this.cloudProvider}-${Date.now().toString(36)}-${token}${extension}`;
  }

  /**
   * Url clients should use to load a stored file: a (signed) CloudFront url
   * when AWS_CLOUDFRONT_URL is configured, otherwise the bucket url.
   */
  getFileUrl(fileName: string): string {
    const signed = fileUrlSigner.sign(fileName);
    if (signed && signed !== fileName) return signed;
    return this.getPublicUrl(fileName);
  }

  getPublicUrl(fileName: string): string {
    return `https://${this.bucketName}.s3.${this.awsRegion}.amazonaws.com/${fileName}`;
  }

  async uploadFile(
    file: Express.Multer.File,
    fileName: string,
  ): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return this.getPublicUrl(fileName);
  }

  /**
   * Validates and uploads an image (JPG, PNG or WEBP up to 2 MB) and returns
   * the stored key to save on the entity column.
   */
  async uploadImage(file: Express.Multer.File): Promise<string> {
    if (!IMAGE_TYPES[file.mimetype])
      throw new BadRequestException('Upload a JPG, PNG or WEBP image');
    if (file.size > IMAGE_MAX_BYTES)
      throw new BadRequestException('Images must be 2 MB or smaller');
    const key = this.getSecureFileName(file.originalname);
    await this.uploadFile(file, key);
    return key;
  }

  /**
   * Removes a stored object. Values that are not stored keys (external urls,
   * empty strings) are ignored, and failures are logged, never thrown.
   */
  async deleteFile(value: string | null | undefined): Promise<void> {
    const key = fileUrlSigner.toKey(value);
    if (!fileUrlSigner.isStoredKey(key)) return;
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Presigned S3 url that downloads a stored file as an attachment named
   * `downloadName`. Signing is local (no network call). Returns null for
   * values that aren't stored keys or signed urls of stored keys.
   */
  async getDownloadUrl(
    value: string | null | undefined,
    downloadName: string,
    expiresIn = 3600,
  ): Promise<string | null> {
    const key = fileUrlSigner.toKey(value);
    if (!fileUrlSigner.isStoredKey(key) || !this.bucketName) return null;
    const safeName = downloadName.replace(/[^\w.-]+/g, '-');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
      }),
      { expiresIn },
    );
  }

  async getFileSignedUrl(fileName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
    });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }
}
