import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import { CsvUpload } from "./csv-upload";

describe("CsvUpload", () => {
  test("uploads the picked file to the batch csv endpoint", async () => {
    let receivedName: string | null = null;
    server.use(
      http.post("/api/v1/batches/b1/csv", async ({ request }) => {
        const form = await request.formData();
        const file = form.get("file");
        // undici reconstructs uploads as its own File class, so instanceof File
        // (jsdom's) is unreliable — duck-type on `name` instead.
        receivedName =
          file && typeof file === "object" && "name" in file ? String(file.name) : null;
        return HttpResponse.json({ batch: { id: "b1", items: [] } });
      }),
    );

    renderWithProviders(<CsvUpload batchId="b1" />);
    const file = new File(["amount,description\n10000,Test"], "invoices.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("csv-file"), file);
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));

    await waitFor(() => expect(receivedName).toBe("invoices.csv"));
  });

  test("keeps the import button disabled until a file is chosen", () => {
    renderWithProviders(<CsvUpload batchId="b1" />);
    expect(screen.getByRole("button", { name: /import csv/i })).toBeDisabled();
  });
});
