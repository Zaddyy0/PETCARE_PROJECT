/**
 * API router.
 *
 * Everything is mounted under a version prefix (`/api/v1`) so a future
 * breaking change can ship as `/api/v2` alongside it rather than as a flag day
 * where every client must update at once.
 */

import { Router } from 'express';
import analyticsRoutes from './analytics.routes.js';
import appointmentRoutes from './appointment.routes.js';
import authRoutes from './auth.routes.js';
import doctorRoutes from './doctor.routes.js';
import medicalRoutes from './medical.routes.js';
import notificationRoutes from './notification.routes.js';
import petRoutes from './pet.routes.js';
import reviewRoutes from './review.routes.js';
import uploadRoutes from './upload.routes.js';
import userRoutes from './user.routes.js';

const router: Router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/pets', petRoutes);
router.use('/doctors', doctorRoutes);
router.use('/appointments', appointmentRoutes);
/* Medical records and vaccinations share a prefix — they are one clinical
   surface from a client's point of view, and both hang off a pet. */
router.use('/medical', medicalRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/uploads', uploadRoutes);

export default router;
