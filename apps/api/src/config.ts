import { z } from "zod";

// default() is placed BEFORE transform() so the default flows through the
// same enum→boolean conversion as a provided value.
const boolFromString = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

const devLoginBool = z
  .string()
  .optional()
  .default("false")
  .transform((v) => v === "true");

const oidcSchema = z.object({
  issuerUrl: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().min(1),
  identityClaim: z.string().min(1).default("sub"),
  groupsClaim: z.string().min(1).default("groups"),
  emailClaim: z.string().min(1).default("email"),
  nameClaim: z.string().min(1).default("name"),
});

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  port: z.coerce.number().int().default(3001),
  sessionTtlMinutes: z.coerce.number().int().default(720),
  cookieSecure: boolFromString,
  keyEncryptionKey: z.string().min(1, "KEY_ENCRYPTION_KEY is required"),
  moyasarBaseUrl: z.string().min(1).default("https://api.moyasar.com/v1"),
  jobPollIntervalMs: z.coerce.number().int().default(2000),
  syncIntervalMs: z.coerce.number().int().default(300000),
  oidc: oidcSchema,
  appAccessGroupId: z.string().min(1),
  devLogin: devLoginBool,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse({
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    sessionTtlMinutes: env.SESSION_TTL_MINUTES,
    cookieSecure: env.COOKIE_SECURE,
    keyEncryptionKey: env.KEY_ENCRYPTION_KEY,
    moyasarBaseUrl: env.MOYASAR_BASE_URL,
    jobPollIntervalMs: env.JOB_POLL_INTERVAL_MS,
    syncIntervalMs: env.SYNC_INTERVAL_MS,
    appAccessGroupId: env.APP_ACCESS_GROUP_ID,
    devLogin: env.DEV_LOGIN,
    oidc: {
      issuerUrl: env.OIDC_ISSUER_URL,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      redirectUri: env.OIDC_REDIRECT_URI,
      identityClaim: env.OIDC_IDENTITY_CLAIM,
      groupsClaim: env.OIDC_GROUPS_CLAIM,
      emailClaim: env.OIDC_EMAIL_CLAIM,
      nameClaim: env.OIDC_NAME_CLAIM,
    },
  });
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
