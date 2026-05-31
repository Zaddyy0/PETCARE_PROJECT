import { Router } from 'express';
import { createPet, deletePet, getPetById, getPets, updatePet } from '../controllers/petController.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadSingleImage } from '../middleware/upload.js';

const router = Router();

router.use(requireAuth);
router.get('/', getPets);
router.get('/:id', getPetById);
router.post('/', uploadSingleImage, createPet);
router.put('/:id', uploadSingleImage, updatePet);
router.delete('/:id', deletePet);

export default router;
