import { describe, expect, test } from "vitest";
import { renderWithProviders } from "./utils";

describe("test harness", () => {
  test("renders a component with providers", () => {
    const { getByText } = renderWithProviders(<div>hello ops</div>);
    expect(getByText("hello ops")).toBeInTheDocument();
  });
});
