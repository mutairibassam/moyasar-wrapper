import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./data-table";

type Row = { id: string; name: string };
const columns: ColumnDef<Row>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name" },
];
const data: Row[] = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Beta" },
  { id: "3", name: "Gamma" },
];

describe("DataTable", () => {
  test("renders headers, rows, pager and drives page changes", async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={data}
        meta={{ page: 1, perPage: 20, total: 60, totalPages: 3 }}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3 rows
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();

    const prev = screen.getByRole("button", { name: /prev/i });
    expect(prev).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  test("shows empty node when there is no data", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        meta={{ page: 1, perPage: 20, total: 0, totalPages: 0 }}
        onPageChange={vi.fn()}
        empty={<div>Nothing here</div>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
