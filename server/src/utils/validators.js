import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

export function cleanString(value, { field, max = 120, required = true } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) {
      return '';
    }

    throw new ApiError(400, `${field} must be a string.`);
  }

  const normalized = value.trim();

  if (required && !normalized) {
    throw new ApiError(400, `${field} is required.`);
  }

  if (normalized.length > max) {
    throw new ApiError(400, `${field} must be at most ${max} characters.`);
  }

  return normalized;
}

export function cleanEmail(value) {
  const email = cleanString(value, { field: 'Email', max: 254, required: true }).toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    throw new ApiError(400, 'Email format is invalid.');
  }

  return email;
}

export function cleanPassword(value) {
  const password = cleanString(value, { field: 'Password', max: 128, required: true });

  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long.');
  }

  return password;
}

export function cleanNonNegativeNumber(value, { field, max = 100 } = {}) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new ApiError(400, `${field} must be a valid number.`);
  }

  if (number < 0 || number > max) {
    throw new ApiError(400, `${field} must be between 0 and ${max}.`);
  }

  return number;
}

export function cleanDate(value, { field } = {}) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${field} must be a valid date/time.`);
  }

  return parsed;
}

export function assertObjectId(id, { field = 'Id' } = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, `${field} is invalid.`);
  }
}
