import type { Container } from "./container";
import type { PublicUser } from "./modules/auth/public-user";

export type AppEnv = {
  Variables: {
    container: Container;
    user?: PublicUser;
    sessionToken?: string;
  };
};

export function clientIp(header: string | undefined): string | null {
  if (!header) return null;
  return header.split(",")[0]!.trim() || null;
}
