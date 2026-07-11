import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginPage from "./page";

describe("LoginPage", () => {
  test("offers a Microsoft sign-in link to the API login route", () => {
    render(<LoginPage />);
    const link = screen.getByRole("link", { name: /sign in with microsoft/i });
    expect(link).toHaveAttribute("href", "/api/v1/auth/login");
  });
});
