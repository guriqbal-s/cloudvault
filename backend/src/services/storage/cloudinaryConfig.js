// Reads Cloudinary credentials from an env-like object. Dependency-free so the seed script can
// use it without loading (and validating) the whole backend config.

/**
 * Separate CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET win; CLOUDINARY_URL
 * (cloudinary://KEY:SECRET@CLOUD_NAME) fills in anything missing.
 * @returns {{ cloudName: string, apiKey: string, apiSecret: string }}
 */
export function cloudinaryCredentials(v) {
  let fromUrl = {};
  if (v.CLOUDINARY_URL) {
    try {
      const u = new URL(v.CLOUDINARY_URL);
      if (u.protocol === 'cloudinary:') {
        fromUrl = { cloudName: u.hostname, apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password) };
      }
    } catch {
      /* treated as missing; env validation reports it */
    }
  }
  return {
    cloudName: v.CLOUDINARY_CLOUD_NAME || fromUrl.cloudName || '',
    apiKey: v.CLOUDINARY_API_KEY || fromUrl.apiKey || '',
    apiSecret: v.CLOUDINARY_API_SECRET || fromUrl.apiSecret || '',
  };
}

/** True when a value is empty or still the YOUR_... placeholder from .env.example. */
export const isPlaceholder = (value) => !value || /^YOUR_/i.test(value);
