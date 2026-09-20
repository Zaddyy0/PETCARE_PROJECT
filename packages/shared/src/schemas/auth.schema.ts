import { z } from 'zod';
import { ROLES } from '../enums.js';
import {
  emailSchema,
  nameSchema,
  objectIdSchema,
  passwordSchema,
  phoneSchema,
} from './common.schema.js';

export const loginSchema = z.object({
  email: emailSchema,
  /**
   * Note: no `passwordSchema` here.
   *
   * Applying the strength policy at sign-in would reject the password of any
   * account created before the policy tightened, and it leaks the policy to an
   * attacker enumerating credentials. Sign-in checks only that something was
   * sent; strength is enforced where passwords are *set*.
   */
  password: z.string().min(1, 'Enter your password').max(128),
  rememberMe: z.boolean().default(false),
});

export const registerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the terms to continue' }),
  }),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, 'This reset link looks incomplete').max(256),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Your new password must be different',
    path: ['newPassword'],
  });

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(20, 'This invitation link looks incomplete').max(256),
  password: passwordSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(20).max(256),
});

export const refreshSchema = z.object({
  /**
   * Optional because the refresh token normally rides in an httpOnly cookie.
   * The body field exists only for non-browser clients (a future mobile app),
   * which cannot use cookies.
   */
  refreshToken: z.string().trim().min(20).max(512).optional(),
});

export const impersonateSchema = z.object({
  userId: objectIdSchema,
  /** Required and audited — "why" is the whole point of an impersonation log. */
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(300),
});

export const roleSchema = z.enum(ROLES);

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type ImpersonateInput = z.infer<typeof impersonateSchema>;
