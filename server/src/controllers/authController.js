import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getJwtSecret } from '../utils/jwtSecret.js';
import { cleanEmail, cleanPassword, cleanString } from '../utils/validators.js';

function createToken(userId) {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}

export const register = asyncHandler(async (req, res) => {
  const name = cleanString(req.body.name, { field: 'Name', max: 100, required: true });
  const email = cleanEmail(req.body.email);
  const password = cleanPassword(req.body.password);

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(400, 'An account with this email already exists.');
  }

  const user = await User.create({
    name,
    email,
    password
  });

  const token = createToken(user._id);

  res.status(201).json(new ApiResponse(201, { user, token }, 'Account created successfully.'));
});

export const login = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = cleanPassword(req.body.password);

  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  const token = createToken(user._id);
  res.status(200).json(new ApiResponse(200, { user, token }, 'Logged in successfully.'));
});

export const me = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(200, req.user, 'Current user loaded.'));
});
