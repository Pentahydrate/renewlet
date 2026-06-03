import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@/components/app-scroll-restoration", () => ({
  AppScrollRestoration: () => null,
}));

vi.mock("@/components/protected-route", () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/pages/settings", () => new Promise(() => undefined));

describe("App route fallback", () => {
  it("uses the settings page skeleton for the settings route while the chunk loads", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("settings-page-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("settings-page-skeleton-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-page-skeleton")).not.toBeInTheDocument();
  });
});
