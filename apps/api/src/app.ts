import { Hono } from "hono";
import { AppError } from "./errors";

type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: unknown;
};

function problemResponse(problem: Problem): Response {
  const body: Problem = { ...problem };
  if (body.detail === undefined) delete body.detail;
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export function createApp(): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.notFound(() =>
    problemResponse({ type: "not_found", title: "Not Found", status: 404 }),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return problemResponse({
        type: err.type,
        title: err.message,
        status: err.status,
        detail: err.detail,
      });
    }
    console.error(`[unhandled] ${c.req.method} ${c.req.path}`, err);
    return problemResponse({
      type: "internal_error",
      title: "Internal Server Error",
      status: 500,
    });
  });

  return app;
}
