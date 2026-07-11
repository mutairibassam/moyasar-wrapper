"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

export function useSession() {
  const q = useQuery({ queryKey: qk.me, queryFn: () => api.auth.me(), retry: false });
  return { user: q.data?.user, isLoading: q.isLoading, isError: q.isError };
}
