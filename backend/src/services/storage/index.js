// Storage factory. Application code imports { storage } from here and never a concrete
// provider. STORAGE_DRIVER picks the backend: local disk or Cloudinary.

import { env } from '../../config/env.js';
import LocalStorageProvider from './LocalStorageProvider.js';
import CloudinaryStorageProvider from './CloudinaryStorageProvider.js';

function createStorage() {
  switch (env.storage.driver) {
    case 'local':
      return new LocalStorageProvider({ root: env.storage.root });
    case 'cloudinary':
      return new CloudinaryStorageProvider(env.storage.cloudinary);
    case 's3':
      throw new Error(
        'STORAGE_DRIVER=s3 is not implemented yet. Add services/storage/S3StorageProvider.js ' +
          'implementing StorageProvider (AWS integration is a later phase).'
      );
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${env.storage.driver}`);
  }
}

export const storage = createStorage();
export * as keys from './keys.js';
export { StorageError } from './StorageProvider.js';
