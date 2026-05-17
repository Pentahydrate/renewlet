import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Subscription } from "@/types/subscription";
import { SubscriptionCalendar } from "./subscription-calendar";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: {
      categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
      statuses: [],
      paymentMethods: [],
      currencies: [],
    },
  }),
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number) => amount,
    getCurrencySymbol: (currency: string) => (currency === "USD" ? "$" : currency),
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { defaultCurrency: "USD" },
  }),
}));

function subscription(overrides: SubscriptionOverrides = {}): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub-1",
    name: "Aws",
    logo: undefined,
    price: 15,
    currency: "USD",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-05-14"),
    nextBillingDate: assertDateOnly("2026-05-14"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    reminderDays: 3,
    tags: [],
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
  };

  if (overrides.billingCycle === "custom") {
    return {
      ...base,
      ...overrides,
      billingCycle: "custom",
      customDays: overrides.customDays ?? 30,
    };
  }

  return {
    ...base,
    ...overrides,
    billingCycle: overrides.billingCycle ?? "monthly",
    customDays: undefined,
  };
}

function renderCalendar(subscriptions: Subscription[]) {
  return render(
    <TooltipProvider delayDuration={0}>
      <SubscriptionCalendar subscriptions={subscriptions} />
    </TooltipProvider>,
  );
}

function mockMobileCalendar(matches = true) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 639px)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("SubscriptionCalendar dialogs", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("describes the subscription detail dialog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([subscription()]);

    fireEvent.click(screen.getByRole("button", { name: "Aws" }));

    expect(screen.getByRole("dialog", { name: /Aws/ })).toHaveAccessibleDescription(
      "查看 Aws 的价格、周期、日期、标签、网站和备注。",
    );
  });

  it("renders the detail dialog logo on the shared neutral logo tile without cropping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({
        name: "Apple",
        logo: "https://example.com/apple.svg",
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Apple" }));

    const logo = screen.getByAltText("Apple");
    const logoTile = logo.closest(".subscription-logo-tile");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logo).not.toHaveClass("object-cover");
    expect(logoTile).not.toBeNull();
    expect(logoTile).toHaveClass("subscription-logo-tile");
  });

  it("uses the same detail dialog logo path for dark transparent logos", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({
        name: "Better Stack Uptime Team",
        logo: "https://example.com/better-stack-dark-logo.svg",
      }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Better Stack Uptime Team" }));

    const logo = screen.getByAltText("Better Stack Uptime Team");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logo.closest(".subscription-logo-tile")).not.toBeNull();
  });

  it("keeps the detail dialog initials fallback inside the shared logo tile", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([subscription({ name: "dmit", logo: undefined })]);

    fireEvent.click(screen.getByRole("button", { name: "dmit" }));

    const initials = screen.getByText("DM");
    const logoTile = initials.closest(".subscription-logo-tile");

    expect(initials).toHaveClass("subscription-logo-fallback");
    expect(logoTile).not.toBeNull();
    expect(logoTile).toHaveClass("subscription-logo-tile");
  });

  it("describes the day subscription list dialog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({ id: "sub-1", name: "Aws" }),
      subscription({ id: "sub-2", name: "Netflix" }),
      subscription({ id: "sub-3", name: "OpenAI" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "+1 更多" }));

    expect(screen.getByRole("dialog", { name: "5月14日 续费" })).toHaveAccessibleDescription(
      "选择 5月14日 要查看的订阅。",
    );
  });

  it("renders day list logos on the shared neutral logo tile without cropping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({ id: "sub-1", name: "Apple", logo: "https://example.com/apple.svg" }),
      subscription({ id: "sub-2", name: "Better Stack Uptime Team", logo: "https://example.com/better-stack.svg" }),
      subscription({ id: "sub-3", name: "OpenAI" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "+1 更多" }));

    const logo = screen.getByAltText("Better Stack Uptime Team");
    const logoTile = logo.closest(".subscription-logo-tile");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logo).not.toHaveClass("object-cover");
    expect(logoTile).not.toBeNull();
    expect(logoTile).toHaveClass("subscription-logo-tile");
  });

  it("renders the mobile agenda with only active and trial subscriptions", async () => {
    mockMobileCalendar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({ id: "sub-1", name: "Aws", status: "active", nextBillingDate: assertDateOnly("2026-05-14") }),
      subscription({ id: "sub-2", name: "Netflix", status: "trial", nextBillingDate: assertDateOnly("2026-05-16"), billingCycle: "annual", price: 120 }),
      subscription({ id: "sub-3", name: "Paused Cloud", status: "paused", nextBillingDate: assertDateOnly("2026-05-14") }),
      subscription({ id: "sub-4", name: "Cancelled Tool", status: "cancelled", nextBillingDate: assertDateOnly("2026-05-16") }),
    ]);

    expect(screen.getByText("本月续费明细")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aws/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Netflix/ })).toBeInTheDocument();
    expect(screen.getByText("每月")).toBeInTheDocument();
    expect(screen.getByText("每年")).toBeInTheDocument();
    expect(screen.queryByText("Paused Cloud")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelled Tool")).not.toBeInTheDocument();
  });

  it("opens the mobile day drawer from a renewal date marker", async () => {
    mockMobileCalendar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({ id: "sub-1", name: "Aws" }),
      subscription({ id: "sub-2", name: "Netflix" }),
      subscription({ id: "sub-3", name: "OpenAI" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "5月14日 3 个续费" }));

    expect(screen.getByRole("dialog", { name: "5月14日 续费" })).toHaveAccessibleDescription(
      "选择 5月14日 要查看的订阅。",
    );
  });

  it("opens subscription details from the mobile agenda list", async () => {
    mockMobileCalendar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([subscription()]);

    fireEvent.click(screen.getByRole("button", { name: /Aws/ }));

    expect(screen.getByRole("dialog", { name: /Aws/ })).toHaveAccessibleDescription(
      "查看 Aws 的价格、周期、日期、标签、网站和备注。",
    );
  });
});
