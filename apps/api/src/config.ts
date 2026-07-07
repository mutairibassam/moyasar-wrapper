import { z } from "zod";

// default() is placed BEFORE transform() so the default flows through the
// same enum→boolean conversion as a provided value.
const boolFromString = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  port: z.coerce.number().int().default(3001),
  sessionTtlMinutes: z.coerce.number().int().default(720),
  cookieSecure: boolFromString,
  loginRateMax: z.coerce.number().int().default(5),
  loginRateWindowMinutes: z.coerce.number().int().default(15),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    sessionTtlMinutes: env.SESSION_TTL_MINUTES,
    cookieSecure: env.COOKIE_SECURE,
    loginRateMax: env.LOGIN_RATE_MAX,
    loginRateWindowMinutes: env.LOGIN_RATE_WINDOW_MINUTES,
  });
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
