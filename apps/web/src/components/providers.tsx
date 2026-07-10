"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } }),
  );
  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
