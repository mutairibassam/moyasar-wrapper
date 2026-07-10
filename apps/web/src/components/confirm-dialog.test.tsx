import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  test("fires onConfirm when the action is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete thing?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        trigger={<Button>Open</Button>}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
