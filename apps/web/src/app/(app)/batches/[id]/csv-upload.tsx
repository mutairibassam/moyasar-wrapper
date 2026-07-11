"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

export function CsvUpload({ batchId }: { batchId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: (f: File) => api.batches.uploadCsv(batchId, f),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.batch(batchId) });
      toast.success("CSV imported");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "CSV import failed");
    },
  });

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="csv-file"
        className="text-sm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!file || mutation.isPending}
        onClick={() => file && mutation.mutate(file)}
      >
        <Upload className="size-4" />
        Import CSV
      </Button>
    </div>
  );
}
