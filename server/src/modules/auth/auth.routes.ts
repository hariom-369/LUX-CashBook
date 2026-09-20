import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter, emailLimiter } from '../../middleware/rateLimit.js';
import * as controller from './auth.controller.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  setPinSchema,
  verifyEmailSchema,
  verifyPinSchema,
} from './auth.schema.js';

export const authRouter: Router = Router();

// ── Public. Every one of these is rate limited: they are the endpoints an
//    attacker reaches without credentials.

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(controller.register),
);

authRouter.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(controller.login));

authRouter.post('/refresh', asyncHandler(controller.refresh));

authRouter.post('/logout', asyncHandler(controller.logout));

authRouter.post(
  '/forgot-password',
  emailLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(controller.resetPassword),
);

authRouter.post(
  '/verify-email',
  authLimiter,
  validate({ body: verifyEmailSchema }),
  asyncHandler(controller.verifyEmail),
);

authRouter.post('/password-strength', controller.checkPasswordStrength);

// ── Authenticated.

authRouter.get('/me', requireAuth, asyncHandler(controller.me));

authRouter.post('/logout-all', requireAuth, asyncHandler(controller.logoutAll));

authRouter.post(
  '/resend-verification',
  requireAuth,
  emailLimiter,
  asyncHandler(controller.resendVerification),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);

authRouter.post(
  '/pin',
  requireAuth,
  authLimiter,
  validate({ body: setPinSchema }),
  asyncHandler(controller.setPin),
);

authRouter.delete(
  '/pin',
  requireAuth,
  authLimiter,
  validate({ body: setPinSchema.pick({ password: true }) }),
  asyncHandler(controller.removePin),
);

authRouter.post(
  '/pin/verify',
  requireAuth,
  authLimiter,
  validate({ body: verifyPinSchema }),
  asyncHandler(controller.verifyPin),
);
