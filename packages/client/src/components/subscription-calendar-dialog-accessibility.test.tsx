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

describe("SubscriptionCalendar dialogs", () => {
  afterEach(() => {
    vi.useRealTimers();
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
});
