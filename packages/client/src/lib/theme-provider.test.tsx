import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ThemeProvider, THEME_MODE_OVERRIDE_STORAGE_KEY, useTheme } from "./theme-provider";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider defaultTheme="dark">{children}</ThemeProvider>;
}

describe("ThemeProvider local override", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      configurable: true,
    });
  });

  it("marks direct theme changes as a local device override", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("light");
    });

    expect(localStorage.getItem("renewlet_theme_mode")).toBe("light");
    expect(localStorage.getItem(THEME_MODE_OVERRIDE_STORAGE_KEY)).toBe("1");
  });

  it("can sync account theme without writing a local override", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("light", { localOverride: false });
    });

    expect(localStorage.getItem("renewlet_theme_mode")).toBe("light");
    expect(localStorage.getItem(THEME_MODE_OVERRIDE_STORAGE_KEY)).toBeNull();
  });
});
