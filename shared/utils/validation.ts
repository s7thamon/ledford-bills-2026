import { z } from 'zod'

export const newPasswordSchema = z.string()
  .min(12, 'Use at least 12 characters.')
  .max(255)
  .regex(/[a-z]/, 'Add a lowercase letter.')
  .regex(/[A-Z]/, 'Add an uppercase letter.')
  .regex(/\d/, 'Add a number.')
