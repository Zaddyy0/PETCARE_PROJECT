import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizePhotoUrlForClient } from '../utils/photoUrl.js';
import { assertObjectId, cleanNonNegativeNumber, cleanString } from '../utils/validators.js';

function serializePet(req, pet) {
  const plainPet = pet.toObject ? pet.toObject() : { ...pet };

  return {
    ...plainPet,
    photoUrl: normalizePhotoUrlForClient(req, plainPet.photoUrl)
  };
}

function resolvePhotoUrl(req) {
  if (req.file) {
    return `/uploads/${req.file.filename}`;
  }

  return req.body.photoUrl || '';
}

export const getPets = asyncHandler(async (req, res) => {
  const pets = await Pet.find({ owner: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, pets.map((pet) => serializePet(req, pet)), 'Pets loaded.'));
});

export const getPetById = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, { field: 'Pet id' });

  const pet = await Pet.findOne({ _id: req.params.id, owner: req.user._id });
  if (!pet) {
    throw new ApiError(404, 'Pet profile not found.');
  }

  res.status(200).json(new ApiResponse(200, serializePet(req, pet), 'Pet loaded.'));
});

export const createPet = asyncHandler(async (req, res) => {
  const name = cleanString(req.body.name, { field: 'Pet name', max: 80, required: true });
  const type = cleanString(req.body.type, { field: 'Pet type', max: 40, required: true });
  const breed = cleanString(req.body.breed ?? '', { field: 'Breed', max: 80, required: false });
  const age = cleanNonNegativeNumber(req.body.age, { field: 'Age', max: 60 });

  const pet = await Pet.create({
    owner: req.user._id,
    name,
    type,
    breed,
    age,
    photoUrl: resolvePhotoUrl(req)
  });

  res.status(201).json(new ApiResponse(201, serializePet(req, pet), 'Pet created successfully.'));
});

export const updatePet = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, { field: 'Pet id' });

  const pet = await Pet.findOne({ _id: req.params.id, owner: req.user._id });
  if (!pet) {
    throw new ApiError(404, 'Pet profile not found.');
  }

  const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
  const hasType = Object.prototype.hasOwnProperty.call(req.body, 'type');
  const hasBreed = Object.prototype.hasOwnProperty.call(req.body, 'breed');
  const hasAge = Object.prototype.hasOwnProperty.call(req.body, 'age');

  if (hasName) {
    pet.name = cleanString(req.body.name, { field: 'Pet name', max: 80, required: true });
  }

  if (hasType) {
    pet.type = cleanString(req.body.type, { field: 'Pet type', max: 40, required: true });
  }

  if (hasBreed) {
    pet.breed = cleanString(req.body.breed ?? '', { field: 'Breed', max: 80, required: false });
  }

  if (hasAge) {
    pet.age = cleanNonNegativeNumber(req.body.age, { field: 'Age', max: 60 });
  }

  const photoUrl = resolvePhotoUrl(req);
  if (photoUrl) {
    pet.photoUrl = photoUrl;
  }

  await pet.save();

  res.status(200).json(new ApiResponse(200, serializePet(req, pet), 'Pet updated successfully.'));
});

export const deletePet = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, { field: 'Pet id' });

  const isDeleteConfirmed = req.body?.confirmDelete === true || req.body?.confirmDelete === 'true';
  if (!isDeleteConfirmed) {
    throw new ApiError(400, 'Deletion requires explicit confirmation.');
  }

  const pet = await Pet.findOne({ _id: req.params.id, owner: req.user._id });
  if (!pet) {
    throw new ApiError(404, 'Pet profile not found.');
  }

  await Appointment.deleteMany({ owner: req.user._id, pet: pet._id });
  await pet.deleteOne();

  res.status(200).json(new ApiResponse(200, { deletedId: pet._id }, 'Pet deleted successfully.'));
});
