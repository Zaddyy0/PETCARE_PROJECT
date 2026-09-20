import type { Request, Response } from 'express';
import { ERROR_CODES } from '@pawsitive/shared';
import { Pet } from '../models/pet.model.js';
import { User } from '../models/user.model.js';
import * as uploadService from '../services/upload.service.js';
import { loadPetForActor } from '../services/pet.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { requireFile } from '../middleware/upload.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendSuccess } from '../utils/api-response.js';

/**
 * Replace a pet's photo.
 *
 * Ownership is checked through `loadPetForActor` *before* the upload, so a
 * caller cannot make us do the work — and pay for the storage — for a pet they
 * cannot reach.
 */
export const petPhoto = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const file = requireFile(req.file);

  const pet = await loadPetForActor(auth, req.params['id'] as string);

  if (!auth.permissions.has('pet:update:own') && !auth.permissions.has('pet:update:any')) {
    throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
  }

  /* The bytes must actually be an image — a declared MIME type is a claim. */
  uploadService.assertRealImage(file.buffer, file.mimetype);

  const previousPublicId = pet.photo?.publicId;

  const asset = await uploadService.uploadImage(file.buffer, file.mimetype, {
    folder: 'pets',
    /* Keyed on the pet, so replacing a photo overwrites rather than
       accumulating a new asset on every edit. */
    publicId: `pet-${pet._id.toString()}`,
  });

  pet.photo = {
    url: asset.url,
    publicId: asset.publicId,
    ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
  };

  await pet.save();

  /* Only clean up when the id actually changed — an overwrite reuses it, and
     deleting it here would remove the image we just stored. */
  if (previousPublicId && previousPublicId !== asset.publicId) {
    void uploadService.deleteImage(previousPublicId);
  }

  sendSuccess(res, { photo: pet.photo }, 'Photo updated.');
});

export const avatar = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const file = requireFile(req.file);

  uploadService.assertRealImage(file.buffer, file.mimetype);

  const user = await User.findById(auth.userId);
  if (!user) throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);

  const previousPublicId = user.avatar?.publicId;

  const asset = await uploadService.uploadImage(file.buffer, file.mimetype, {
    folder: 'avatars',
    publicId: `user-${user._id.toString()}`,
  });

  user.avatar = {
    url: asset.url,
    publicId: asset.publicId,
    ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
  };

  await user.save();

  if (previousPublicId && previousPublicId !== asset.publicId) {
    void uploadService.deleteImage(previousPublicId);
  }

  sendSuccess(res, { avatar: user.avatar }, 'Avatar updated.');
});

/** Remove a pet's photo entirely. */
export const removePetPhoto = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const pet = await loadPetForActor(auth, req.params['id'] as string);

  if (!pet.photo) {
    sendSuccess(res, { photo: null }, 'No photo to remove.');
    return;
  }

  const publicId = pet.photo.publicId;
  pet.photo = null;
  await pet.save();

  void uploadService.deleteImage(publicId);

  sendSuccess(res, { photo: null }, 'Photo removed.');
});

export { Pet };
