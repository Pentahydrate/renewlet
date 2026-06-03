import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import Calendar from "./calendar";

const mocks = vi.hoisted(() => ({
  useSubscriptions: vi.fn(),
  createMutation: { mutate: vi.fn() },
  updateMutation: { mutate: vi.fn() },
}));

vi.mock("@/hooks/use-subscriptions", () => ({
  useSubscriptions: mocks.useSubscriptions,
  useCreateSubscription: () => mocks.createMutation,
  useUpdateSubscription: () => mocks.updateMutation,
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/subscription-calendar", () => ({
  SubscriptionCalendar: () => <div data-testid="subscription-calendar" />,
}));

vi.mock("@/components/edit-subscription-dialog", () => ({
  EditSubscriptionDialog: () => null,
}));

function mockMatchMedia(matchesByQuery: Record<string, boolean>) {
  // 日历页是否启用按钮依赖媒体查询；jsdom 需要显式 mock 才能覆盖 H5/桌面两个分支。
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesByQuery[query] ?? false,
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

function setScrollMetrics(element: HTMLElement) {
  // jsdom 不会根据 DOM 内容计算滚动高度，手动补齐滚动指标才能触发按钮的阈值逻辑。
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 1200 });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 800 });
  element.scrollTop = 420;
}

function renderCalendarPage({ mobile }: { mobile: boolean }) {
  mockMatchMedia({
    "(max-width: 639px)": mobile,
    "(prefers-reduced-motion: reduce)": false,
  });
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  setScrollMetrics(root);

  render(
    <TooltipProvider delayDuration={0}>
      <Calendar />
    </TooltipProvider>,
    { container: root },
  );

  return root;
}

describe("Calendar page back-to-top float button", () => {
  beforeEach(() => {
    mocks.useSubscriptions.mockReturnValue({
      data: [],
      isPending: false,
    });
  });

  it("renders a page-isomorphic skeleton while subscriptions are pending", () => {
    mocks.useSubscriptions.mockReturnValue({
      data: undefined,
      isPending: true,
    });

    renderCalendarPage({ mobile: false });

    const skeleton = screen.getByTestId("calendar-skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.querySelectorAll(".grid-cols-7 .animate-pulse")).toHaveLength(49);
    expect(screen.queryByTestId("subscription-calendar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the back-to-top float button on H5 calendar pages", async () => {
    const root = renderCalendarPage({ mobile: true });

    fireEvent.scroll(root);

    expect(await screen.findByRole("button", { name: "回到顶部" })).toBeInTheDocument();
  });

  it("does not show the back-to-top float button on desktop calendar pages", async () => {
    const root = renderCalendarPage({ mobile: false });

    fireEvent.scroll(root);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();
    });
  });
});
