// Statistics 页面测试保护统计模型到图表 UI 的装配，避免 Recharts 容器和金额口径脱节。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import type { Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import Statistics from "./statistics";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

const mocks = vi.hoisted(() => ({
  handleAddSubscription: vi.fn(),
  refreshRates: vi.fn(),
  rechartsCellProps: [] as Array<Record<string, unknown>>,
  rechartsLegendProps: [] as Array<Record<string, unknown>>,
  rechartsPieChartProps: [] as Array<Record<string, unknown>>,
  rechartsPieProps: [] as Array<Record<string, unknown>>,
  rechartsResponsiveContainerProps: [] as Array<Record<string, unknown>>,
  rechartsTooltipProps: [] as Array<Record<string, unknown>>,
  useCustomConfig: vi.fn(),
  useSettings: vi.fn(),
  useSubscriptionCrud: vi.fn(),
  useSubscriptions: vi.fn(),
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("recharts", () => ({
  Cell: (props: Record<string, unknown>) => {
    mocks.rechartsCellProps.push(props);
    return null;
  },
  Legend: (props: Record<string, unknown>) => {
    mocks.rechartsLegendProps.push(props);
    return <div data-testid="recharts-legend" />;
  },
  Pie: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
    mocks.rechartsPieProps.push(props);
    return <div>{children}</div>;
  },
  PieChart: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
    mocks.rechartsPieChartProps.push(props);
    return <div>{children}</div>;
  },
  ResponsiveContainer: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
    mocks.rechartsResponsiveContainerProps.push(props);
    return <div>{children}</div>;
  },
  Tooltip: (props: Record<string, unknown>) => {
    mocks.rechartsTooltipProps.push(props);
    return null;
  },
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: mocks.useCustomConfig,
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number) => amount,
    error: null,
    getCurrencySymbol: () => "¥",
    lastUpdated: null,
    loading: false,
    refresh: mocks.refreshRates,
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: mocks.useSettings,
}));

vi.mock("@/hooks/use-subscriptions", () => ({
  useSubscriptions: mocks.useSubscriptions,
}));

vi.mock("@/modules/subscriptions/application/use-subscription-crud", () => ({
  useSubscriptionCrud: mocks.useSubscriptionCrud,
}));

function subscription(overrides: SubscriptionOverrides): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub",
    name: "Service",
    logo: undefined,
    price: 10,
    currency: "CNY",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2099-01-05"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    tags: [],
    reminderDays: 3,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    pinned: false,
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

function renderStatistics() {
  return render(
    <TooltipProvider delayDuration={0}>
      <Statistics />
    </TooltipProvider>,
  );
}

describe("Statistics page", () => {
  beforeEach(() => {
    mocks.rechartsCellProps.length = 0;
    mocks.rechartsLegendProps.length = 0;
    mocks.rechartsPieChartProps.length = 0;
    mocks.rechartsPieProps.length = 0;
    mocks.rechartsResponsiveContainerProps.length = 0;
    mocks.rechartsTooltipProps.length = 0;
    mocks.useCustomConfig.mockReturnValue({ config: DEFAULT_CUSTOM_CONFIG });
    mocks.useSettings.mockReturnValue({
      data: {
        defaultCurrency: "CNY",
        monthlyBudget: 500,
        timezone: "UTC",
      },
      isPending: false,
    });
    mocks.useSubscriptionCrud.mockReturnValue({ handleAddSubscription: mocks.handleAddSubscription });
    mocks.useSubscriptions.mockReturnValue({
      data: [
        subscription({ id: "active", status: "active", price: 20 }),
        subscription({ id: "paused", status: "paused", price: 10 }),
        subscription({ id: "cancelled", status: "cancelled", price: 20 }),
      ],
      isPending: false,
    });
  });

  it("renders a page-isomorphic skeleton while statistics inputs are pending", () => {
    mocks.useSubscriptions.mockReturnValue({
      data: undefined,
      isPending: true,
    });

    renderStatistics();

    const skeleton = screen.getByTestId("statistics-skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.querySelectorAll(".rounded-xl.border.border-border.bg-card")).toHaveLength(14);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the inactive savings explanation on hover", async () => {
    const user = userEvent.setup();

    renderStatistics();

    expect(screen.getByText("停用月节省")).toBeInTheDocument();
    expect(screen.getByText("¥30")).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: "说明：停用月节省" }));

    expect(
      await screen.findAllByText("已暂停、已取消和已过期订阅按月折算后的金额，不包含活跃或试用订阅，也不是预算剩余。"),
    ).not.toHaveLength(0);
  });

  it("disables position animation for all chart tooltips", () => {
    renderStatistics();

    expect(mocks.rechartsTooltipProps).toHaveLength(3);
    for (const props of mocks.rechartsTooltipProps) {
      expect(props["isAnimationActive"]).toBe(false);
      expect(props["offset"]).toBe(12);
      expect(props["allowEscapeViewBox"]).toEqual({ x: true, y: true });
      expect(props["wrapperStyle"]).toEqual({ pointerEvents: "none" });
    }
  });

  it("renders crisp donut charts without Recharts-managed legends", () => {
    renderStatistics();

    expect(mocks.rechartsLegendProps).toHaveLength(0);
    expect(mocks.rechartsPieChartProps).toHaveLength(3);
    expect(mocks.rechartsPieChartProps.map((props) => props["title"])).toEqual(["分类视图", "支付方式视图", "费用与预算"]);
    for (const props of mocks.rechartsPieChartProps) {
      expect(props).toEqual(
        expect.objectContaining({
          accessibilityLayer: true,
          margin: { top: 4, right: 4, bottom: 4, left: 4 },
          tabIndex: 0,
        }),
      );
    }
    expect(mocks.rechartsPieProps).toHaveLength(3);
    for (const props of mocks.rechartsPieProps) {
      expect(props).toEqual(
        expect.objectContaining({
          cy: "50%",
          innerRadius: "58%",
          outerRadius: "90%",
          rootTabIndex: -1,
          strokeWidth: 0,
        }),
      );
    }
    expect(screen.getAllByRole("list")).toHaveLength(3);
  });

  it("gives Recharts positive dimensions before ResizeObserver reports layout", () => {
    renderStatistics();

    for (const frame of screen.getAllByTestId("statistics-chart-frame")) {
      expect(frame).toHaveClass("recharts-frame");
    }
    expect(mocks.rechartsResponsiveContainerProps).toHaveLength(3);
    for (const props of mocks.rechartsResponsiveContainerProps) {
      const initialDimension = props["initialDimension"] as { width: number; height: number };

      expect(props).toEqual(
        expect.objectContaining({
          width: "100%",
          height: 220,
          minWidth: 0,
          debounce: 50,
        }),
      );
      expect(props["height"]).not.toBe("100%");
      expect(initialDimension.width).toBeGreaterThan(0);
      expect(initialDimension.height).toBe(220);
    }
  });

  it("uses the same subtle hover feedback as the dashboard spending chart", () => {
    renderStatistics();

    expect(mocks.rechartsCellProps.length).toBeGreaterThan(0);
    for (const props of mocks.rechartsCellProps) {
      expect(props["focusable"]).toBe(false);
      expect(props["className"]).toBe("transition-all duration-300 hover:opacity-80");
    }
  });

  it("makes the inactive annual savings explanation keyboard reachable", async () => {
    const user = userEvent.setup();

    renderStatistics();

    expect(screen.getByText("停用年节省")).toBeInTheDocument();
    expect(screen.getByText("¥360")).toBeInTheDocument();

    await user.tab();
    await user.tab();
    await user.tab();

    const annualHelp = screen.getByRole("button", { name: "说明：停用年节省" });
    expect(annualHelp).toHaveFocus();
    expect(await screen.findAllByText("停用月节省乘以 12，用于估算一年少支出的订阅费用。")).not.toHaveLength(0);
  });
});
