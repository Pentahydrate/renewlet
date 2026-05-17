import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import type { FixedCycleSubscription, Subscription } from "@/types/subscription";
import Dashboard from "./dashboard";

const mocks = vi.hoisted(() => ({
  handleAddSubscription: vi.fn(),
  handleDeleteSubscription: vi.fn(),
  handleEditDialogOpenChange: vi.fn(),
  handleEditSubscription: vi.fn(),
  handleSaveSubscription: vi.fn(),
  ratesLoading: false,
  useSettings: vi.fn(),
  useSubscriptions: vi.fn(),
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/router-link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/loading-skeleton", () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton" />,
}));

vi.mock("@/components/subscription-card", () => ({
  SubscriptionCard: ({ subscription }: { subscription: Subscription }) => (
    <article data-testid="subscription-card">{subscription.name}</article>
  ),
}));

vi.mock("@/components/spending-chart", () => ({
  SpendingChart: ({ subscriptions }: { subscriptions: Subscription[] }) => (
    <div data-testid="spending-chart">{subscriptions.length}</div>
  ),
}));

vi.mock("@/components/upcoming-renewals", () => ({
  UpcomingRenewals: ({ subscriptions }: { subscriptions: Subscription[] }) => (
    <div data-testid="upcoming-renewals">{subscriptions.length}</div>
  ),
}));

vi.mock("@/components/edit-subscription-dialog", () => ({
  EditSubscriptionDialog: () => null,
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number, from: string, to: string) => {
      if (from === to) return amount;
      if (from === "USD" && to === "CNY") return amount * 7;
      return amount;
    },
    loading: mocks.ratesLoading,
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: mocks.useSettings,
}));

vi.mock("@/hooks/use-subscriptions", () => ({
  useSubscriptions: mocks.useSubscriptions,
}));

vi.mock("@/modules/subscriptions/application/use-subscription-crud", () => ({
  useSubscriptionCrud: () => ({
    editingSubscription: undefined,
    editDialogOpen: false,
    handleAddSubscription: mocks.handleAddSubscription,
    handleDeleteSubscription: mocks.handleDeleteSubscription,
    handleEditDialogOpenChange: mocks.handleEditDialogOpenChange,
    handleEditSubscription: mocks.handleEditSubscription,
    handleSaveSubscription: mocks.handleSaveSubscription,
  }),
}));

function subscription(overrides: Partial<FixedCycleSubscription> = {}): FixedCycleSubscription {
  return {
    id: "codex-pro",
    name: "Codex Pro",
    logo: undefined,
    price: 200,
    currency: "USD",
    billingCycle: "monthly",
    customDays: undefined,
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-04-18"),
    nextBillingDate: assertDateOnly("2026-05-18"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    tags: [],
    reminderDays: 3,
    ...overrides,
  };
}

function mockResolvedDashboardData() {
  mocks.useSubscriptions.mockReturnValue({
    data: [subscription()],
    isPending: false,
  });
  mocks.useSettings.mockReturnValue({
    data: {
      defaultCurrency: "CNY",
      exchangeRateProvider: "frankfurter",
      timezone: "Asia/Shanghai",
    },
    isPending: false,
  });
}

describe("Dashboard page loading state", () => {
  beforeEach(() => {
    mocks.ratesLoading = false;
    mockResolvedDashboardData();
  });

  it("keeps dashboard content visible while exchange rates are loading", () => {
    mocks.ratesLoading = true;

    render(<Dashboard />);

    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("近期订阅")).toBeInTheDocument();
    expect(screen.getByText("Codex Pro")).toBeInTheDocument();
    expect(screen.getByText("汇率加载中...")).toBeInTheDocument();
  });

  it.each([
    ["subscriptions", { subscriptionsPending: true, settingsPending: false }],
    ["settings", { subscriptionsPending: false, settingsPending: true }],
  ])("shows the skeleton while %s data is still pending", (_label, state) => {
    mocks.useSubscriptions.mockReturnValue({
      data: state.subscriptionsPending ? undefined : [subscription()],
      isPending: state.subscriptionsPending,
    });
    mocks.useSettings.mockReturnValue({
      data: state.settingsPending
        ? undefined
        : {
            defaultCurrency: "CNY",
            exchangeRateProvider: "frankfurter",
            timezone: "Asia/Shanghai",
          },
      isPending: state.settingsPending,
    });

    render(<Dashboard />);

    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
  });
});
