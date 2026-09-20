import { Router } from 'express';
import { idParamSchema, notificationQuerySchema } from '@pawsitive/shared';
import * as notificationController from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

router.use(authenticate);

/**
 * No permission checks here.
 *
 * Every notification query is pinned to `req.auth.userId` in the controller —
 * a notification belongs to exactly one person, and there is no cross-user
 * read path to authorize. Adding a permission would imply there is.
 */
router.get('/', validate({ query: notificationQuerySchema }), notificationController.list);

/* Before `/:id` — otherwise "counts" would be parsed as a notification id. */
router.get('/counts', notificationController.counts);

router.post('/read-all', notificationController.markAllRead);

router.post(
  '/:id/read',
  validate({ params: idParamSchema }),
  notificationController.markRead,
);

export default router;
