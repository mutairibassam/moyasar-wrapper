import { z } from "zod";
import { USER_ROLES } from "../enums";

const email = z
  .email()
  .transform((e) => e.toLowerCase());

const password = z.string().min(12, "Password must be at least 12 characters").max(200);

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(USER_ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    role: z.enum(USER_ROLES),
    isActive: z.boolean(),
    password,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  actorId: z.uuid().optional(),
  action: z.string().min(1).max(80).optional(),
  entityType: z.string().min(1).max(80).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
