import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// Shared happy-path server; individual tests override handlers via server.use(...).
export const server = setupServer(...handlers);
