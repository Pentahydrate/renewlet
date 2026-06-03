// Dashboard 页面测试保护首页 hook 装配和统计入口，避免页面层绕过 domain 模型直接计算金额。
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
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
  DashboardPageSkeleton: () => <div data-testid="dashboard-skeleton" />,
}));

vi.mock("@/components/subscription-card", () => ({
  SubscriptionCard: ({ subscription, inheritedReminderDays }: { subscription: Subscription; inheritedReminderDays: number }) => (
    <article data-testid="subscription-card">
      {subscription.name}
      <span data-testid="subscription-card-reminder">{inheritedReminderDays}</span>
    </article>
  ),
}));

vi.mock("@/components/spending-chart", () => ({
  SpendingChart: ({
    subscriptions,
    defaultCurrency,
    timeZone,
    exchangeRateProvider,
  }: {
    subscriptions: Subscription[];
    defaultCurrency: string;
    timeZone: string;
    exchangeRateProvider: string | undefined;
  }) => (
    <div data-testid="spending-chart">
      {subscriptions.length}:{defaultCurrency}:{timeZone}:{exchangeRateProvider}
    </div>
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

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: DEFAULT_CUSTOM_CONFIG,
  }),
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
    pinned: false,
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-04-18"),
    nextBillingDate: assertDateOnly("2026-05-18"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    tags: [],
    reminderDays: 3,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
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
      exchangeRateProvider: "exchange-api",
      notificationReminderDays: 5,
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
    expect(screen.getByTestId("subscription-card-reminder")).toHaveTextContent("5");
    expect(screen.getByTestId("spending-chart")).toHaveTextContent("1:CNY:Asia/Shanghai:exchange-api");
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
            exchangeRateProvider: "exchange-api",
            notificationReminderDays: 5,
            timezone: "Asia/Shanghai",
          },
      isPending: state.settingsPending,
    });

    render(<Dashboard />);

    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
  });
});
