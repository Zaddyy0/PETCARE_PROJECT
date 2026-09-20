import { Router } from 'express';
import { idParamSchema } from '@pawsitive/shared';
import * as uploadController from '../controllers/upload.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { uploadLimiter } from '../middleware/rate-limit.js';
import { uploadSingleImage } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

router.use(authenticate);

/**
 * Middleware order matters here.
 *
 * The rate limiter runs *before* multer, so a flood of oversized uploads is
 * rejected at the door rather than after each body has been buffered into
 * memory. Reversing the two would mean the limiter protects the handler but not
 * the parser — which is where the cost actually is.
 *
 * `validate` runs after multer because the multipart body does not exist until
 * multer has parsed it.
 */
router.post(
  '/pets/:id/photo',
  uploadLimiter,
  uploadSingleImage,
  validate({ params: idParamSchema }),
  uploadController.petPhoto,
);

router.delete(
  '/pets/:id/photo',
  validate({ params: idParamSchema }),
  uploadController.removePetPhoto,
);

router.post('/me/avatar', uploadLimiter, uploadSingleImage, uploadController.avatar);

export default router;
