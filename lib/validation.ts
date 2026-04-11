import { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Matches DB constraint: ^[a-zA-Z0-9._]{3,30}$
export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username too long')
  .regex(/^[a-zA-Z0-9._]{3,30}$/, 'Letters, numbers, dots and underscores only');

export const credentialsSchema = loginSchema.extend({
  inviteCode: z.string().min(12).max(12).optional().or(z.literal('')),
});

export const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(80, 'Name too long')
  .trim();

export const bioSchema = z
  .string()
  .max(160, 'Bio must be 160 characters or fewer')
  .optional();

export const citySchema = z.enum(['riyadh', 'dubai']);

// ── Eatery ────────────────────────────────────────────────────────────────

export const eateryReviewSchema = z.object({
  rank: z.number().int().min(1).max(5),
  text: z.string().max(500, 'Review must be 500 characters or fewer').optional(),
  favourite_dish: z.string().max(100, 'Favourite dish too long').optional(),
});

export const eateryAddSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  location_text: z.string().min(1, 'Address is required'),
  latitude: z.number(),
  longitude: z.number(),
  city: citySchema,
  website: z.string().url().optional().or(z.literal('')),
  menu_url: z.string().url().optional().or(z.literal('')),
});

// ── Friends ───────────────────────────────────────────────────────────────

export const friendSearchSchema = z.object({
  query: z.string().min(2, 'Enter at least 2 characters').max(50),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type EateryReviewInput = z.infer<typeof eateryReviewSchema>;
export type EateryAddInput = z.infer<typeof eateryAddSchema>;
export type FriendSearchInput = z.infer<typeof friendSearchSchema>;
export type City = z.infer<typeof citySchema>;
