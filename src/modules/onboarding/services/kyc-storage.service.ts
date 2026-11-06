import { Injectable } from '@nestjs/common';
import { StorageService } from '../../shared/services/storage.service';

export const KYC_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const KYC_FILE_TYPES: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'application/pdf': 'PDF',
};

/**
 * Stores KYC documents on S3 under unguessable keys. Only the key is kept on
 * the KYC record; Kyc.kyc's transformer serves it as a signed, expiring
 * CloudFront url, so documents are never publicly listable.
 */
@Injectable()
export class KycStorageService {
  constructor(private readonly storageService: StorageService) {}

  async save(file: Express.Multer.File): Promise<string> {
    const key = this.storageService.getSecureFileName(file.originalname);
    await this.storageService.uploadFile(file, key);
    return key;
  }
}
