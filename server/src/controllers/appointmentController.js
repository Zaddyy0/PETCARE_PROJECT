import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizePhotoUrlForClient } from '../utils/photoUrl.js';
import { assertObjectId, cleanDate, cleanString } from '../utils/validators.js';

const allowedStatuses = ['scheduled', 'ongoing', 'completed'];

function normalizeAppointmentPet(req, appointment) {
  const plainAppointment = appointment.toObject ? appointment.toObject() : { ...appointment };

  if (plainAppointment.pet && typeof plainAppointment.pet === 'object') {
    plainAppointment.pet = {
      ...plainAppointment.pet,
      photoUrl: normalizePhotoUrlForClient(req, plainAppointment.pet.photoUrl)
    };
  }

  return plainAppointment;
}

export const getAppointments = asyncHandler(async (req, res) => {
  const appointments = await Appointment.find({ owner: req.user._id })
    .populate('pet', 'name photoUrl type')
    .sort({ datetime: 1 });

  res.status(200).json(new ApiResponse(200, appointments.map((appointment) => normalizeAppointmentPet(req, appointment)), 'Appointments loaded.'));
});

export const createAppointment = asyncHandler(async (req, res) => {
  const petId = cleanString(req.body.petId, { field: 'Pet id', max: 64, required: true });
  const reason = cleanString(req.body.reason, { field: 'Reason', max: 80, required: true });
  const datetime = cleanDate(req.body.datetime, { field: 'Date/time' });

  assertObjectId(petId, { field: 'Pet id' });

  const pet = await Pet.findOne({ _id: petId, owner: req.user._id });
  if (!pet) {
    throw new ApiError(404, 'Selected pet was not found.');
  }

  const appointment = await Appointment.create({
    owner: req.user._id,
    pet: pet._id,
    reason,
    datetime,
    status: 'scheduled'
  });

  const populatedAppointment = await Appointment.findById(appointment._id).populate('pet', 'name photoUrl type');
  res.status(201).json(new ApiResponse(201, normalizeAppointmentPet(req, populatedAppointment), 'Appointment booked successfully.'));
});

export const updateAppointmentStatus = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, { field: 'Appointment id' });

  const status = cleanString(req.body.status, { field: 'Status', max: 20, required: true }).toLowerCase();

  if (!allowedStatuses.includes(status)) {
    throw new ApiError(400, 'Invalid appointment status.');
  }

  const appointment = await Appointment.findOne({ _id: req.params.id, owner: req.user._id }).populate('pet', 'name photoUrl type');
  if (!appointment) {
    throw new ApiError(404, 'Appointment not found.');
  }

  appointment.status = status;
  await appointment.save();

  res.status(200).json(new ApiResponse(200, normalizeAppointmentPet(req, appointment), 'Appointment status updated.'));
});
