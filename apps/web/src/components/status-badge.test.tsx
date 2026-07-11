import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  test("renders a green batch badge for submitted", () => {
    render(<StatusBadge kind="batch" value="submitted" />);
    const el = screen.getByText("submitted");
    expect(el.className).toContain("text-green-800");
  });

  test("renders a red badge for partially_failed with humanized label", () => {
    render(<StatusBadge kind="batch" value="partially_failed" />);
    const el = screen.getByText("partially failed");
    expect(el.className).toContain("text-red-800");
  });

  test("maps moyasar paid to green and expired to red", () => {
    const { rerender } = render(<StatusBadge kind="moyasar" value="paid" />);
    expect(screen.getByText("paid").className).toContain("text-green-800");
    rerender(<StatusBadge kind="moyasar" value="expired" />);
    expect(screen.getByText("expired").className).toContain("text-red-800");
  });
});
