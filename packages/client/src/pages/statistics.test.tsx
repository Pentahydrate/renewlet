// Statistics 页面测试保护统计模型到图表 UI 的装配，避免 Recharts 容器和金额口径脱节。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import type { Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import Statistics from "./statistics";

type RecurringBillingCycle = Exclude<Subscription["billingCycle"], "custom" | "one-time">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays" | "customCycleUnit" | "oneTimeTermCount" | "oneTimeTermUnit">;
type SubscriptionOverrides = Partial<SubscriptionBaseFixture> & (
  | { billingCycle?: RecurringBillingCycle; customDays?: undefined; customCycleUnit?: undefined; oneTimeTermCount?: undefined; oneTimeTermUnit?: undefined }
  | { billingCycle: "one-time"; customDays?: undefined; customCycleUnit?: undefined; oneTimeTermCount?: number; oneTimeTermUnit?: Subscription["oneTimeTermUnit"] }
  | { billingCycle: "custom"; customDays?: number; customCycleUnit?: Subscription["customCycleUnit"]; oneTimeTermCount?: undefined; oneTimeTermUnit?: undefined }
);

const mocks = vi.hoisted(() => ({
  handleAddSubscription: vi.fn(),
  refreshRates: vi.fn(),
  rechartsBarChartProps: [] as Array<Record<string, unknown>>,
  rechartsBarProps: [] as Array<Record<string, unknown>>,
  rechartsCellProps: [] as Array<Record<string, unknown>>,
  rechartsCartesianGridProps: [] as Array<Record<string, unknown>>,
  rechartsLegendProps: [] as Array<Record<string, unknown>>,
  rechartsPieChartProps: [] as Array<Record<string, unknown>>,
  rechartsPieProps: [] as Array<Record<string, unknown>>,
  rechartsResponsiveContainerProps: [] as Array<Record<string, unknown>>,
  rechartsTooltipProps: [] as Array<Record<string, unknown>>,
  rechartsXAxisProps: [] as Array<Record<string, unknown>>,
  rechartsYAxisProps: [] as Array<Record<string, unknown>>,
  useCustomConfig: vi.fn(),
  useSettings: vi.fn(),
  useSubscriptionCrud: vi.fn(),
  useSubscriptions: vi.fn(),
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("recharts", () => ({
  Bar: (props: Record<string, unknown>) => {
    mocks.rechartsBarProps.push(props);
    return null;
  },
  BarChart: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
    mocks.rechartsBarChartProps.push(props);
    return <div>{children}</div>;
  },
  CartesianGrid: (props: Record<string, unknown>) => {
    mocks.rechartsCartesianGridProps.push(props);
    return null;
  },
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
  XAxis: (props: Record<string, unknown>) => {
    mocks.rechartsXAxisProps.push(props);
    return null;
  },
  YAxis: (props: Record<string, unknown>) => {
    mocks.rechartsYAxisProps.push(props);
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
    autoRenew: false,
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
    publicHidden: false,
  };

  if (overrides.billingCycle === "custom") {
    return {
      ...base,
      ...overrides,
      billingCycle: "custom",
      customDays: overrides.customDays ?? 30,
      customCycleUnit: overrides.customCycleUnit ?? "day",
      oneTimeTermCount: undefined,
      oneTimeTermUnit: undefined,
    };
  }

  if (overrides.billingCycle === "one-time") {
    return {
      ...base,
      ...overrides,
      billingCycle: "one-time",
      customDays: undefined,
      customCycleUnit: undefined,
      oneTimeTermCount: overrides.oneTimeTermCount,
      oneTimeTermUnit: overrides.oneTimeTermUnit,
    };
  }

  return {
    ...base,
    ...overrides,
    billingCycle: overrides.billingCycle ?? "monthly",
    customDays: undefined,
    customCycleUnit: undefined,
    oneTimeTermCount: undefined,
    oneTimeTermUnit: undefined,
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
    mocks.rechartsBarChartProps.length = 0;
    mocks.rechartsBarProps.length = 0;
    mocks.rechartsCellProps.length = 0;
    mocks.rechartsCartesianGridProps.length = 0;
    mocks.rechartsLegendProps.length = 0;
    mocks.rechartsPieChartProps.length = 0;
    mocks.rechartsPieProps.length = 0;
    mocks.rechartsResponsiveContainerProps.length = 0;
    mocks.rechartsTooltipProps.length = 0;
    mocks.rechartsXAxisProps.length = 0;
    mocks.rechartsYAxisProps.length = 0;
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
    expect(skeleton.querySelectorAll(".rounded-xl.border.border-border.bg-card")).toHaveLength(15);
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

  it("keeps the personal cost basis switch in the overview heading row", async () => {
    const user = userEvent.setup();
    mocks.useSubscriptions.mockReturnValue({
      data: [
        subscription({
          id: "family-plan",
          price: 100,
          status: "active",
          costSharing: {
            enabled: true,
            splitMode: "custom",
            members: [
              { id: "member", name: "Member", currency: "CNY", customAmount: 60 },
            ],
          },
        }),
      ],
      isPending: false,
    });

    renderStatistics();

    const overviewHeading = screen.getByRole("heading", { name: "总体统计" });
    const personalCostBasisSwitch = screen.getByRole("switch", { name: "按我的份额统计" });
    const overviewHeadingRow = overviewHeading.parentElement;

    if (!overviewHeadingRow) {
      throw new Error("Expected overview heading to be rendered inside a heading row.");
    }

    expect(overviewHeadingRow).toContainElement(personalCostBasisSwitch);
    expect(overviewHeadingRow).toHaveClass("sm:flex-row", "sm:justify-between");
    expect(screen.getAllByText("¥100").length).toBeGreaterThan(0);

    await user.click(personalCostBasisSwitch);

    expect(await screen.findAllByText("¥40")).not.toHaveLength(0);
  });

  it("disables position animation for all chart tooltips", () => {
    renderStatistics();

    expect(mocks.rechartsTooltipProps).toHaveLength(4);
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
    const visibleChartLegends = screen
      .getAllByRole("list")
      .filter((list) => list.getAttribute("aria-label") !== "未来 12 个月费用走势明细");
    expect(visibleChartLegends).toHaveLength(3);
  });

  it("gives Recharts positive dimensions before ResizeObserver reports layout", () => {
    renderStatistics();

    for (const frame of screen.getAllByTestId("statistics-chart-frame")) {
      expect(frame).toHaveClass("recharts-frame");
    }
    const donutContainerProps = mocks.rechartsResponsiveContainerProps.filter((props) => props["height"] === 220);
    expect(donutContainerProps).toHaveLength(3);
    for (const props of donutContainerProps) {
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

  it("renders the trend bar chart with cashflow by default and switches to amortized cost", async () => {
    const user = userEvent.setup();

    renderStatistics();

    expect(screen.getByRole("heading", { name: "费用走势" })).toBeInTheDocument();
    expect(screen.getByText("按未来 12 个月到期或续费日汇总预计扣费。")).toBeInTheDocument();
    expect(mocks.rechartsBarChartProps).toHaveLength(1);
    expect(mocks.rechartsBarChartProps[0]).toEqual(
      expect.objectContaining({
        accessibilityLayer: true,
        title: "未来扣费",
        tabIndex: 0,
      }),
    );
    expect(mocks.rechartsBarProps).toEqual([
      expect.objectContaining({
        dataKey: "cashflow",
        fill: "hsl(var(--chart-1))",
        radius: [4, 4, 0, 0],
        isAnimationActive: false,
        activeBar: {
          fill: "hsl(var(--chart-1))",
          fillOpacity: 0.88,
          stroke: "hsl(var(--chart-1))",
          strokeOpacity: 0.5,
          strokeWidth: 1,
        },
      }),
    ]);
    expect(mocks.rechartsTooltipProps.filter((props) => props["cursor"] === false)).toHaveLength(1);
    expect(mocks.rechartsYAxisProps).toEqual([
      expect.objectContaining({
        domain: [0, "dataMax"],
        width: 72,
      }),
    ]);

    await user.click(screen.getByRole("tab", { name: "月均摊销" }));

    expect(screen.getByText("按当前有效订阅组合估算未来 12 个月的月均成本归属。")).toBeInTheDocument();
    const lastBarChartProps = mocks.rechartsBarChartProps[mocks.rechartsBarChartProps.length - 1];
    const lastBarProps = mocks.rechartsBarProps[mocks.rechartsBarProps.length - 1];
    expect(lastBarChartProps).toEqual(expect.objectContaining({ title: "月均摊销" }));
    expect(lastBarProps).toEqual(expect.objectContaining({ dataKey: "amortized" }));
  });

  it("gives the trend chart positive dimensions before ResizeObserver reports layout", () => {
    renderStatistics();

    expect(screen.getByTestId("statistics-trend-chart-frame")).toHaveClass("recharts-frame");
    const trendFrameProps = mocks.rechartsResponsiveContainerProps.find((props) => props["height"] === 280);
    expect(trendFrameProps).toEqual(
      expect.objectContaining({
        width: "100%",
        height: 280,
        minWidth: 0,
        debounce: 50,
      }),
    );
    const initialDimension = trendFrameProps?.["initialDimension"] as { width: number; height: number };
    expect(initialDimension.width).toBeGreaterThan(0);
    expect(initialDimension.height).toBe(280);
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
