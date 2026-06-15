import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import { DEFAULT_SETTINGS, type Subscription } from "@/types/subscription";
import Subscriptions from "./subscriptions";

type RecurringBillingCycle = Exclude<Subscription["billingCycle"], "custom" | "one-time">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays" | "customCycleUnit" | "oneTimeTermCount" | "oneTimeTermUnit">;
type SubscriptionOverrides = Partial<SubscriptionBaseFixture> & { billingCycle?: RecurringBillingCycle };

const mocks = vi.hoisted(() => ({
  useInfiniteSubscriptions: vi.fn(),
  useSettings: vi.fn(),
  handleAddSubscription: vi.fn(),
  handleDeleteSubscription: vi.fn(),
  handleEditSubscription: vi.fn(),
  handleTogglePinnedSubscription: vi.fn(),
  handleTogglePublicHiddenSubscription: vi.fn(),
  handleSaveSubscription: vi.fn(),
  handleEditDialogOpenChange: vi.fn(),
  exportToJSON: vi.fn(),
  exportToJSONWithSecrets: vi.fn(),
  exportToCSV: vi.fn(),
}));

vi.mock("@/hooks/use-subscriptions", () => ({
  useInfiniteSubscriptions: mocks.useInfiniteSubscriptions,
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: mocks.useSettings,
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number) => amount,
  }),
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: {
      categories: [
        {
          id: "productivity",
          value: "productivity",
          labels: { "zh-CN": "生产力", "en-US": "Productivity" },
          color: "hsl(200 80% 50%)",
        },
        {
          id: "finance",
          value: "finance",
          labels: { "zh-CN": "财务", "en-US": "Finance" },
          color: "hsl(160 84% 45%)",
        },
      ],
      statuses: [],
      paymentMethods: [],
      currencies: [],
    },
    updateCategories: vi.fn(),
    updateStatuses: vi.fn(),
    updatePaymentMethods: vi.fn(),
    updateCurrencies: vi.fn(),
  }),
}));

vi.mock("@/modules/subscriptions/application/use-subscription-crud", () => ({
  useSubscriptionCrud: () => ({
    editingSubscription: undefined,
    editDialogOpen: false,
    handleAddSubscription: mocks.handleAddSubscription,
    handleDeleteSubscription: mocks.handleDeleteSubscription,
    handleEditSubscription: mocks.handleEditSubscription,
    handleTogglePinnedSubscription: mocks.handleTogglePinnedSubscription,
    handleTogglePublicHiddenSubscription: mocks.handleTogglePublicHiddenSubscription,
    handleSaveSubscription: mocks.handleSaveSubscription,
    handleEditDialogOpenChange: mocks.handleEditDialogOpenChange,
  }),
}));

vi.mock("@/modules/subscriptions/application/use-subscription-export", () => ({
  useSubscriptionExport: () => ({
    exportToJSON: mocks.exportToJSON,
    exportToJSONWithSecrets: mocks.exportToJSONWithSecrets,
    exportToCSV: mocks.exportToCSV,
  }),
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/subscription-card", () => ({
  SubscriptionCard: ({ subscription }: { subscription: Subscription }) => (
    <article data-testid="subscription-card">{subscription.name}</article>
  ),
}));

vi.mock("@/components/subscription-detail-dialog", () => ({
  SubscriptionDetailDialog: () => null,
}));

vi.mock("@/components/add-subscription-dialog", () => ({
  AddSubscriptionDialog: ({ trigger }: { trigger?: ReactNode }) => trigger ?? null,
}));

vi.mock("@/components/edit-subscription-dialog", () => ({
  EditSubscriptionDialog: () => null,
}));

vi.mock("@/components/import-data-dialog", () => ({
  ImportDataDialog: () => null,
}));

vi.mock("@/components/ai-recognize-subscription-dialog", () => ({
  AIRecognizeSubscriptionDialog: () => null,
}));

function subscription(overrides: SubscriptionOverrides = {}): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub",
    name: "Service",
    logo: undefined,
    price: 10,
    currency: "USD",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2026-02-01"),
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

function renderSubscriptionsPage() {
  return render(
    <div id="root" style={{ height: 800, overflowY: "auto" }}>
      <TooltipProvider delayDuration={0}>
        <Subscriptions />
      </TooltipProvider>
    </div>,
  );
}

function visibleSubscriptionNames() {
  return screen.getAllByTestId("subscription-card").map((card) => card.textContent ?? "");
}

function mockMobileTagFilterMatch(isMobile: boolean, width = isMobile ? 390 : 1280) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(max-width: 767px)"
          ? isMobile
          : query === "(min-width: 640px)"
            ? width >= 640
            : query === "(min-width: 1024px)"
              ? width >= 1024
              : false,
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

describe("Subscriptions page category filters", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.setPointerCapture ??= vi.fn();
    Element.prototype.releasePointerCapture ??= vi.fn();
    Element.prototype.scrollIntoView ??= vi.fn();
  });

  beforeEach(() => {
    mocks.useSettings.mockReturnValue({
      data: {
        ...DEFAULT_SETTINGS,
        timezone: "Asia/Shanghai",
        defaultCurrency: "CNY",
        notificationReminderDays: 5,
      },
    });
    mocks.useInfiniteSubscriptions.mockReturnValue({
      subscriptions: [
        subscription({ id: "docs", name: "Docs Notes", category: "productivity", tags: ["Docs"] }),
        subscription({ id: "budget", name: "Budget Vault", category: "finance", tags: ["Budget"] }),
        subscription({ id: "sheet", name: "Finance Sheet", category: "finance", tags: ["Sheets"] }),
        subscription({ id: "music", name: "Music Box", category: "music", tags: ["Music"] }),
      ],
      isPending: false,
    });
  });

  it("filters desktop subscriptions from a searchable multi-category popover", async () => {
    const user = userEvent.setup();
    mockMobileTagFilterMatch(false);
    renderSubscriptionsPage();

    const desktopCategoryFilter = screen.getByTestId("desktop-category-filter");
    expect(within(desktopCategoryFilter).getByRole("button", { name: "分类" })).toBeInTheDocument();

    await user.click(within(desktopCategoryFilter).getByRole("button", { name: "分类" }));
    const searchInput = await screen.findByPlaceholderText("搜索分类...");
    await user.type(searchInput, "财");
    expect(screen.queryByText("生产力")).not.toBeInTheDocument();
    await user.click(screen.getByText("财务"));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Budget Vault", "Finance Sheet"]);
    });
    expect(within(desktopCategoryFilter).getByRole("button", { name: "财务" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索分类...")).toBeInTheDocument();

    await user.clear(searchInput);
    await user.click(await screen.findByText("生产力"));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Docs Notes", "Budget Vault", "Finance Sheet"]);
    });
    expect(within(desktopCategoryFilter).getByRole("button", { name: "分类(2)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空分类" }));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Docs Notes", "Budget Vault", "Finance Sheet", "Music Box"]);
    });
    expect(within(desktopCategoryFilter).getByRole("button", { name: "分类" })).toBeInTheDocument();
  });

  it("applies mobile category drawer selections after confirmation", async () => {
    const user = userEvent.setup();
    mockMobileTagFilterMatch(true);
    renderSubscriptionsPage();

    const mobileCategoryFilter = screen.getByTestId("mobile-category-filter");
    expect(within(mobileCategoryFilter).getByRole("button", { name: "分类" })).toBeInTheDocument();

    await user.click(within(mobileCategoryFilter).getByRole("button", { name: "分类" }));
    const drawer = await screen.findByRole("dialog", { name: "筛选分类" });
    const searchInput = screen.getByPlaceholderText("搜索分类...");
    await user.type(searchInput, "财");
    await user.click(screen.getByText("财务"));

    expect(drawer).toBeInTheDocument();
    expect(visibleSubscriptionNames()).toEqual(["Docs Notes", "Budget Vault", "Finance Sheet", "Music Box"]);

    await user.clear(searchInput);
    await user.click(await screen.findByText("生产力"));

    expect(drawer).toBeInTheDocument();
    expect(visibleSubscriptionNames()).toEqual(["Docs Notes", "Budget Vault", "Finance Sheet", "Music Box"]);
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(drawer).not.toBeInTheDocument();
      expect(visibleSubscriptionNames()).toEqual(["Docs Notes", "Budget Vault", "Finance Sheet"]);
    });
    expect(within(mobileCategoryFilter).getByRole("button", { name: "分类(2)" })).toBeInTheDocument();
  });

  it("clears category and tag filters together", async () => {
    const user = userEvent.setup();
    mockMobileTagFilterMatch(false);
    renderSubscriptionsPage();

    const desktopCategoryFilter = screen.getByTestId("desktop-category-filter");
    await user.click(within(desktopCategoryFilter).getByRole("button", { name: "分类" }));
    await user.click(await screen.findByText("财务"));

    const desktopTagFilter = screen.getByTestId("desktop-tag-filter");
    await user.click(within(desktopTagFilter).getByRole("button", { name: "标签" }));
    await user.click(await screen.findByRole("button", { name: "Budget" }));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Budget Vault"]);
    });

    await user.click(screen.getByRole("button", { name: "清除筛选" }));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Docs Notes", "Budget Vault", "Finance Sheet", "Music Box"]);
    });
    expect(within(desktopCategoryFilter).getByRole("button", { name: "分类" })).toBeInTheDocument();
    expect(within(desktopTagFilter).getByRole("button", { name: "标签" })).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-selected-tags")).not.toBeInTheDocument();
  });
});
