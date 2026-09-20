/**
 * Multipart upload handling.
 *
 * **Memory storage, not disk storage.** The file is held in a buffer, validated,
 * streamed to Cloudinary and discarded. Multer's disk storage would write it to
 * a temp directory first, which on an ephemeral container is both pointless and
 * a source of leftover files when a request fails midway.
 *
 * The size limit is enforced here as well as in the service. Multer aborts the
 * stream as soon as the limit is exceeded, so an oversized upload never fully
 * arrives — checking only after the fact would mean buffering the whole thing
 * in memory to then reject it, which is exactly the denial of service the limit
 * exists to prevent.
 */

import multer from 'multer';
import { ERROR_CODES, LIMITS } from '@pawsitive/shared';
import { ApiError } from '../utils/api-error.js';

const storage = multer.memoryStorage();

export const uploadSingleImage = multer({
  storage,
  limits: {
    fileSize: LIMITS.MAX_UPLOAD_BYTES,
    files: 1,
    /* Cap the non-file fields too — an unbounded field count is its own
       memory-exhaustion vector. */
    fields: 10,
    parts: 12,
  },
  fileFilter(_req, file, callback) {
    /* A first, cheap check on the declared type. The authoritative check is
       `assertRealImage`, which inspects the actual bytes — a declared MIME type
       is a claim, not evidence. */
    if (!(LIMITS.ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(
        new ApiError({
          statusCode: 400,
          code: ERROR_CODES.UNSUPPORTED_FILE_TYPE,
          message: 'Please upload a JPEG, PNG, WebP or AVIF image.',
        }),
      );
      return;
    }

    callback(null, true);
  },
}).single('file');

/** Narrow `req.file` and fail cleanly when nothing was sent. */
export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw ApiError.validation([{ field: 'file', message: 'Choose an image to upload' }]);
  }
  return file;
}
