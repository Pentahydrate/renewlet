import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";
import { SubscriptionCard } from "./subscription-card";

const originalWindowOpen = window.open;

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

const mocks = vi.hoisted(() => {
  const longCategoryLabel = "生产力平台和开发者基础设施";
  const shortCategoryLabel = "生产力";

  return {
    longCategoryLabel,
    shortCategoryLabel,
    config: {
      categories: [
        {
          id: "developer-tools",
          value: "developer-tools",
          labels: { "zh-CN": longCategoryLabel, "en-US": longCategoryLabel },
          color: "hsl(200 80% 50%)",
        },
        {
          id: "productivity",
          value: "productivity",
          labels: { "zh-CN": shortCategoryLabel, "en-US": shortCategoryLabel },
          color: "hsl(200 80% 50%)",
        },
      ],
      statuses: [],
      paymentMethods: [],
      currencies: [],
    },
    createSubscriptionCalendarFeed: vi.fn(),
    deleteSubscriptionCalendarFeed: vi.fn(),
    subscriptionCalendarFeedStatus: { data: { enabled: false, feedUrl: undefined as string | undefined }, isLoading: false },
  };
});

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: mocks.config,
    updateCategories: vi.fn(),
    updateStatuses: vi.fn(),
    updatePaymentMethods: vi.fn(),
    updateCurrencies: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { notificationReminderDays: 5 },
  }),
}));

vi.mock("@/hooks/use-calendar-feed", () => ({
  useCreateSubscriptionCalendarFeed: () => ({
    isPending: false,
    mutateAsync: mocks.createSubscriptionCalendarFeed,
  }),
  useDeleteSubscriptionCalendarFeed: () => ({
    isPending: false,
    mutateAsync: mocks.deleteSubscriptionCalendarFeed,
  }),
  useSubscriptionCalendarFeedStatus: () => mocks.subscriptionCalendarFeedStatus,
}));

const baseSubscription: Subscription = {
  id: "sub-1",
  name: "dmit",
  logo: undefined,
  price: 159,
  currency: "USD",
  billingCycle: "monthly",
  customDays: undefined,
  category: "developer-tools",
  status: "active",
  paymentMethod: undefined,
  startDate: assertDateOnly("2026-05-15"),
  nextBillingDate: assertDateOnly("2026-06-15"),
  autoCalculateNextBillingDate: true,
  trialEndDate: undefined,
  website: undefined,
  notes: undefined,
  tags: [],
  reminderDays: 7,
  repeatReminderEnabled: false,
  repeatReminderInterval: "1h",
  repeatReminderWindow: "72h",
};

function createSubscription(overrides: SubscriptionOverrides = {}): Subscription {
  if (overrides.billingCycle === "custom") {
    return {
      ...baseSubscription,
      ...overrides,
      billingCycle: "custom",
      customDays: overrides.customDays ?? 30,
    };
  }

  return {
    ...baseSubscription,
    ...overrides,
    billingCycle: overrides.billingCycle ?? "monthly",
    customDays: undefined,
  };
}

function renderSubscriptionCard(overrides: SubscriptionOverrides = {}) {
  return render(
    <TooltipProvider delayDuration={0}>
      <SubscriptionCard
        subscription={createSubscription(overrides)}
        timeZone="Asia/Shanghai"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </TooltipProvider>,
  );
}

function openMoreActionsMenu() {
  const menuButton = screen.getByRole("button", { name: "更多操作" });
  fireEvent.pointerDown(menuButton, { button: 0, ctrlKey: false });
  fireEvent.click(menuButton);
}

function mockUserAgent(userAgent: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
  return () => {
    if (descriptor) {
      Object.defineProperty(window.navigator, "userAgent", descriptor);
    } else {
      Reflect.deleteProperty(window.navigator, "userAgent");
    }
  };
}

describe("SubscriptionCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00.000Z"));
    mocks.createSubscriptionCalendarFeed.mockReset();
    mocks.deleteSubscriptionCalendarFeed.mockReset();
    mocks.subscriptionCalendarFeedStatus = { data: { enabled: false, feedUrl: undefined }, isLoading: false };
    mocks.createSubscriptionCalendarFeed.mockResolvedValue({
      enabled: true,
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z",
      feedUrl: "https://example.com/calendar/renewals.ics?token=secret",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "open", { configurable: true, value: originalWindowOpen });
  });

  it("renders subscription logos on the shared neutral logo tile", () => {
    renderSubscriptionCard({ logo: "https://example.com/apple-tv.svg", name: "Apple TV" });

    const logo = screen.getByAltText("Apple TV");
    const logoTile = logo.closest("div");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logoTile).toHaveClass("subscription-logo-tile");
    expect(logoTile).not.toHaveClass("bg-gradient-to-br");
    expect(logoTile?.getAttribute("style")).not.toContain("accent");
  });

  it("uses the same neutral logo path for white transparent logos", () => {
    renderSubscriptionCard({ logo: "https://example.com/white-logo.svg", name: "ngrok" });

    const logo = screen.getByAltText("ngrok");
    const logoTile = logo.closest("div");

    expect(logo).toHaveClass("subscription-logo-image", "object-contain");
    expect(logoTile).toHaveClass("subscription-logo-tile");
    expect(logoTile?.getAttribute("style")).not.toContain("accent");
  });

  it("keeps the initials fallback inside the neutral logo tile", () => {
    renderSubscriptionCard({ name: "dmit", logo: undefined });

    const initials = screen.getByText("DM");
    const logoTile = initials.closest("div");

    expect(initials).toHaveClass("subscription-logo-fallback");
    expect(logoTile).toHaveClass("subscription-logo-tile");
    expect(logoTile).not.toHaveClass("bg-gradient-to-br");
  });

  it("lets the badge group use the full header width before wrapping", () => {
    renderSubscriptionCard();

    const categoryText = screen.getByText(mocks.longCategoryLabel);
    const categoryBadge = categoryText.closest("div");
    const badgeGroup = categoryBadge?.parentElement;
    const statusBadge = screen.getByText("活跃").closest("div");
    const subscriptionName = screen.getByText(baseSubscription.name);

    expect(badgeGroup).toHaveClass("col-span-full", "flex", "flex-wrap", "items-center", "gap-2");
    expect(badgeGroup).not.toHaveClass("overflow-hidden");
    expect(subscriptionName).toHaveAttribute("data-slot", "truncated-tooltip-text");
    expect(subscriptionName).not.toHaveAttribute("title");
    expect(categoryBadge).not.toHaveAttribute("title");
    expect(categoryBadge).toHaveClass(
      "max-w-full",
      "shrink-0",
      "overflow-hidden",
      "whitespace-nowrap",
    );
    expect(categoryBadge).not.toHaveClass("min-w-[3.5rem]", "max-w-[7.5rem]");
    expect(categoryText).toHaveClass("block", "max-w-full", "truncate");
    expect(statusBadge).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("shows short category labels inside the badge", () => {
    renderSubscriptionCard({ category: "productivity" });

    const categoryText = screen.getByText(mocks.shortCategoryLabel);
    const categoryBadge = categoryText.closest("div");

    expect(categoryBadge).toHaveTextContent(mocks.shortCategoryLabel);
    expect(categoryBadge).not.toHaveAttribute("title");
    expect(categoryBadge).not.toHaveClass("min-w-[3.5rem]", "max-w-[7.5rem]");
    expect(categoryText).toHaveAttribute("data-slot", "truncated-tooltip-text");
    expect(categoryText).toHaveClass("block", "max-w-full", "truncate");
  });

  it("always exposes the overflow menu trigger", () => {
    renderSubscriptionCard();

    const menuButton = screen.getByRole("button", { name: "更多操作" });

    expect(menuButton).toHaveClass("h-8", "w-8", "shrink-0");
    expect(menuButton).not.toHaveClass("opacity-0");
    expect(menuButton.getAttribute("class")).not.toContain("group-hover:opacity-100");
  });

  it("orders overflow menu actions with matching icons and separates the destructive action", () => {
    renderSubscriptionCard();

    openMoreActionsMenu();

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual(["编辑", "添加到日历", "删除"]);
    const [editItem, calendarItem, deleteItem] = menuItems as [HTMLElement, HTMLElement, HTMLElement];
    expect(editItem).toHaveClass("gap-2.5", "px-2.5", "py-2", "text-sm");
    expect(calendarItem).toHaveClass("gap-2.5", "px-2.5", "py-2", "text-sm");
    expect(deleteItem).toHaveClass(
      "gap-2.5",
      "px-2.5",
      "py-2",
      "text-sm",
      "text-destructive",
      "focus:bg-destructive/10",
      "focus:text-destructive",
    );
    expect(editItem).not.toHaveClass("text-destructive");
    expect(calendarItem).not.toHaveClass("text-destructive");

    const separator = screen.getByRole("separator");
    expect(calendarItem.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator.compareDocumentPosition(deleteItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the add-to-calendar dialog from the overflow menu", async () => {
    const open = vi.fn();
    Object.defineProperty(window, "open", { configurable: true, value: open });
    renderSubscriptionCard({
      name: "Fastmail",
      website: "https://fastmail.example",
      notes: "Team renewal",
    });

    openMoreActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "添加到日历" }));

    expect(screen.getByRole("dialog", { name: "添加到日历" })).toBeInTheDocument();
    expect(screen.getByText("为「Fastmail」创建单独日历订阅，只同步这一条续费。")).toBeInTheDocument();
    const generateButton = screen.getByRole("button", { name: "生成订阅链接" });
    expect(generateButton).toHaveClass("bg-primary");
    expect(screen.queryByRole("link", { name: "打开系统日历" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载 ICS 文件" })).toHaveClass("border");
    expect(screen.getByText("在线日历服务")).toBeInTheDocument();
    expect(screen.getByText("事件日期")).toBeInTheDocument();
    expect(screen.getByText("2026年6月15日")).toBeInTheDocument();
    expect(screen.getByText("事件类型")).toBeInTheDocument();
    expect(screen.getByText("订阅 Feed")).toBeInTheDocument();
    expect(screen.getByText("同步状态")).toBeInTheDocument();
    expect(screen.getByText("持续同步此订阅")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用 Google Calendar 打开" })).toHaveAttribute(
      "href",
      expect.stringContaining("calendar.google.com"),
    );
    expect(screen.queryByRole("button", { name: "用 Google Calendar 打开" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用 Outlook.com 打开" })).not.toHaveClass("bg-primary");
    expect(screen.getByRole("link", { name: "用 Office 365 打开" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用 Yahoo Calendar 打开" })).toBeInTheDocument();
    expect(screen.getByText("系统订阅使用私有 URL；下载 ICS 和在线日历入口都是一次性添加。")).toBeInTheDocument();

    vi.useRealTimers();
    fireEvent.click(generateButton);
    await waitFor(() => expect(mocks.createSubscriptionCalendarFeed).toHaveBeenCalledWith("sub-1"));
    expect(open).toHaveBeenCalledWith("webcal://example.com/calendar/renewals.ics?token=secret", "_self");
    expect(screen.getByLabelText("本次订阅 URL")).toHaveValue("https://example.com/calendar/renewals.ics?token=secret");
    expect(screen.getByRole("button", { name: "复制 URL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成订阅链接" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "在系统日历中订阅" })).toHaveAttribute(
      "href",
      "webcal://example.com/calendar/renewals.ics?token=secret",
    );
  });

  it("shows an existing per-subscription feed URL without generating a new token", () => {
    mocks.subscriptionCalendarFeedStatus = {
      data: {
        enabled: true,
        feedUrl: "https://example.com/calendar/renewals.ics?token=existing",
      },
      isLoading: false,
    };

    renderSubscriptionCard({ name: "Fastmail" });

    openMoreActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "添加到日历" }));

    expect(screen.getByRole("link", { name: "在系统日历中订阅" })).toHaveAttribute(
      "href",
      "webcal://example.com/calendar/renewals.ics?token=existing",
    );
    expect(screen.getByLabelText("本次订阅 URL")).toHaveValue("https://example.com/calendar/renewals.ics?token=existing");
    expect(screen.queryByRole("button", { name: "生成订阅链接" })).not.toBeInTheDocument();
    expect(mocks.createSubscriptionCalendarFeed).not.toHaveBeenCalled();
  });

  it("uses an Android insert intent for the system calendar entry in Chrome on Android", () => {
    const restoreUserAgent = mockUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36");

    try {
      renderSubscriptionCard({ name: "Fastmail", website: "https://fastmail.example" });

      openMoreActionsMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "添加到日历" }));

      const androidSingleEventLink = screen.getByRole("link", { name: "添加单次事件到 Android 日历" });
      expect(androidSingleEventLink).toHaveAttribute("href", expect.stringContaining("intent://renewlet/calendar-event#Intent;"));
      expect(androidSingleEventLink).toHaveAttribute("href", expect.stringContaining("action=android.intent.action.INSERT"));
      expect(androidSingleEventLink).toHaveAttribute("href", expect.stringContaining("type=vnd.android.cursor.dir/event"));
      expect(androidSingleEventLink).toHaveAttribute("href", expect.stringContaining("S.title=Fastmail"));
    } finally {
      restoreUserAgent();
    }
  });

  it("keeps the add-to-calendar entry available for one-time subscriptions", () => {
    renderSubscriptionCard({ billingCycle: "one-time" });

    openMoreActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "添加到日历" }));

    expect(screen.getByRole("dialog", { name: "添加到日历" })).toBeInTheDocument();
    expect(screen.getByText("事件日期")).toBeInTheDocument();
    expect(screen.getByText("2026年6月15日")).toBeInTheDocument();
  });

  it("renders overdue active subscriptions with the expired status treatment", () => {
    renderSubscriptionCard({ status: "active", nextBillingDate: assertDateOnly("2026-05-15") });

    const statusBadge = screen.getByText("已过期").closest("div");
    const expiredDateText = screen.getByText("已过期 3 天");
    const card = statusBadge?.closest(".group");

    expect(statusBadge).toHaveClass("bg-destructive/10", "text-destructive", "border-destructive/20");
    expect(expiredDateText.closest("div")).toHaveClass("text-destructive");
    expect(card).toHaveClass("border-destructive/40");
    expect(screen.queryByText("到期: 2026/5/15")).not.toBeInTheDocument();
  });

  it("renders inherited reminder days with the current global setting", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionCard
          subscription={createSubscription({ reminderDays: -1 })}
          viewMode="list"
          timeZone="Asia/Shanghai"
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("默认提醒：提前 5 天")).toBeInTheDocument();
  });
});
