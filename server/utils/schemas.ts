import { z } from 'zod'

export const centsSchema = z.number().int().positive().max(100_000_000)
export const splitsSchema = z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(100_000_000))

export const recurringSchema = z.object({
  type: z.enum(['bill', 'reimbursement']),
  name: z.string().trim().min(1).max(255),
  amountCents: centsSchema,
  dayOfMonth: z.number().int().min(1).max(31),
  otherUserId: z.number().int().positive().nullish(),
  splits: splitsSchema.optional(),
  active: z.boolean().optional()
})

export const reimbursementSchema = z.object({
  name: z.string().trim().min(1).max(255),
  owedCents: centsSchema,
  notes: z.string().max(2000).nullish()
})
