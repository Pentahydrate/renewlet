// 订阅弹窗测试覆盖新增/编辑状态机、默认货币同步和 date-only 自动推算边界。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";
import { SubscriptionDialog } from "./subscription-dialog";

const mocks = vi.hoisted(() => ({
  config: {
    categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
    statuses: [{ id: "active", value: "active", labels: { "zh-CN": "活跃", "en-US": "Active" } }],
    paymentMethods: [{ id: "alipay", value: "alipay", labels: { "zh-CN": "支付宝", "en-US": "Alipay" } }],
    currencies: [
      { id: "CNY", value: "CNY", labels: { "zh-CN": "人民币 (¥)", "en-US": "Chinese yuan (¥)" }, enabled: true },
      { id: "USD", value: "USD", labels: { "zh-CN": "美元 ($)", "en-US": "US dollar ($)" }, enabled: true },
      { id: "EUR", value: "EUR", labels: { "zh-CN": "欧元 (€)", "en-US": "Euro (€)" }, enabled: true },
    ],
  },
}));

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
    data: { defaultCurrency: "USD", notificationReminderDays: 5 },
  }),
}));

vi.mock("@/components/logo-picker", () => ({
  LogoPicker: () => null,
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
});

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Critical SaaS",
    logo: undefined,
    price: 99,
    currency: "USD",
    billingCycle: "monthly",
    customDays: undefined,
    customCycleUnit: undefined,
    category: "productivity",
    status: "active",
    publicHidden: false,
    paymentMethod: "alipay",
    startDate: assertDateOnly("2026-05-14"),
    nextBillingDate: assertDateOnly("2026-06-13"),
    autoCalculateNextBillingDate: false,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    reminderDays: 3,
    tags: [],
    repeatReminderEnabled: true,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    pinned: false,
    ...overrides,
  } as Subscription;
}

describe("SubscriptionDialog", () => {
  it("shows field errors on empty create submit instead of relying on native validation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </TooltipProvider>,
    );

    expect(document.querySelector("form")).toHaveAttribute("novalidate");

    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    expect(screen.getByText("请输入服务名称")).toBeInTheDocument();
    expect(screen.getByText("金额必须是 0 到 1,000,000,000 之间的有效数字")).toBeInTheDocument();
    const startDateButton = document.getElementById("startDate");
    const nextBillingDateButton = document.getElementById("nextBillingDate");
    if (!(startDateButton instanceof HTMLButtonElement) || !(nextBillingDateButton instanceof HTMLButtonElement)) {
      throw new Error("Date buttons were not rendered");
    }
    const dateError = screen.getByText("请选择开始日期和下次扣费日期");
    expect(dateError).toBeInTheDocument();
    const autoCalculateHelp = screen.getByText("根据开始日期和扣费周期自动计算");
    expect(startDateButton).toHaveAttribute("aria-invalid", "true");
    expect(startDateButton).toHaveAttribute("aria-describedby", "dates-error");
    expect(startDateButton.parentElement).toContainElement(dateError);
    expect(nextBillingDateButton).toHaveAttribute("aria-invalid", "false");
    expect(nextBillingDateButton).toHaveAttribute("aria-describedby", autoCalculateHelp.id);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the action footer in normal flow without oversized scroll padding", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </TooltipProvider>,
    );

    const form = document.querySelector("form");
    const dialog = screen.getByRole("dialog", { name: "添加新订阅" });
    const header = document.querySelector("[data-subscription-dialog-header]");
    const scrollRegion = form?.firstElementChild;
    const footer = screen.getByRole("button", { name: "添加订阅" }).closest("div");

    expect(dialog).toHaveClass("h5-dialog-frame", "h5-subscription-dialog-panel");
    expect(dialog).not.toHaveClass("h-fit");
    expect(header).toHaveClass("shrink-0");
    expect(form).toHaveClass("h5-subscription-dialog-form");
    expect(scrollRegion).toHaveClass("h5-mobile-sheet-scroll", "h5-subscription-dialog-scroll", "py-4");
    expect(scrollRegion?.className).not.toContain("--subscription-dialog-footer-space");
    expect(scrollRegion?.className).not.toContain("md:max-h-[calc(90vh-12rem)]");
    expect(scrollRegion).not.toHaveClass("pb-[calc(10rem+env(safe-area-inset-bottom))]");
    expect(footer).toHaveClass("shrink-0");
    expect(footer).not.toHaveClass("absolute");
  });

  it("keeps a manually selected create currency instead of syncing back to the default", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </TooltipProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "添加新订阅" });
    expect(dialog).toHaveAccessibleDescription(/填写订阅名称/);
    expect(screen.getByLabelText("服务名称")).toBeInTheDocument();
    const priceInput = screen.getByLabelText("价格");
    expect(priceInput).toHaveAttribute("type", "text");
    expect(priceInput).toHaveAttribute("inputmode", "decimal");
    expect(screen.queryByRole("spinbutton", { name: "价格" })).not.toBeInTheDocument();

    const currencySelect = screen.getByRole("combobox", { name: "选择货币" });
    expect(currencySelect).toHaveTextContent("美元 ($)");

    await user.click(currencySelect);
    await user.click(await screen.findByText("人民币 (¥)"));

    expect(screen.getByRole("combobox", { name: "选择货币" })).toHaveTextContent("人民币 (¥)");
  });

  it("defaults new subscriptions to manual renewal and submits explicit auto-renew opt-in", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </TooltipProvider>,
    );

    const autoRenewSwitch = screen.getByRole("switch", { name: "自动续订" });
    expect(autoRenewSwitch).not.toBeChecked();

    await user.click(autoRenewSwitch);
    await user.type(screen.getByLabelText("服务名称"), "Opt-in SaaS");
    await user.type(screen.getByLabelText("价格"), "10");
    await user.click(screen.getByRole("button", { name: /开始日期.*选择日期/ }));
    await user.click(await screen.findByRole("button", { name: /2026年6月8日/ }));
    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Opt-in SaaS",
      autoRenew: true,
    }));
  });

  it("keeps auto renewal off when switching from one-time back to a recurring cycle", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </TooltipProvider>,
    );

    const billingCycleSelect = screen.getByRole("combobox", { name: "扣费周期" });
    expect(screen.getByRole("switch", { name: "自动续订" })).not.toBeChecked();

    await user.click(billingCycleSelect);
    await user.click(await screen.findByRole("option", { name: "一次性购买" }));
    expect(screen.queryByRole("switch", { name: "自动续订" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "扣费周期" }));
    await user.click(await screen.findByRole("option", { name: "每年" }));

    expect(screen.getByRole("switch", { name: "自动续订" })).not.toBeChecked();
  });

  it("submits custom billing cycles with selectable units", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({ autoCalculateNextBillingDate: true })}
        />
      </TooltipProvider>,
    );

    const billingCycleSelect = screen.getByRole("combobox", { name: "扣费周期" });
    await user.click(billingCycleSelect);
    await user.click(await screen.findByRole("option", { name: "自定义" }));

    const inlineControl = screen.getByTestId("custom-cycle-inline-control");
    expect(inlineControl).toHaveClass("min-w-0", "grid-cols-[auto_minmax(0,1fr)_5rem]");
    await user.type(screen.getByLabelText("自定义周期"), "3");
    await user.click(screen.getByRole("combobox", { name: "自定义周期单位" }));
    await user.click(await screen.findByRole("option", { name: "年" }));

    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      id: "sub-1",
      billingCycle: "custom",
      customDays: 3,
      customCycleUnit: "year",
      nextBillingDate: "2029-05-14",
    }));
  });

  it("keeps explicit reminder days when editing historical subscriptions", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: 30 })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("combobox", { name: "到期提醒" })).toHaveTextContent("提前 30 天");
  });

  it("shows inherited reminder selections when editing inherited subscriptions", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: -1 })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("combobox", { name: "到期提醒" })).toHaveTextContent("默认值从设置中获取（提前 5 天）");
  });

  it("shows disabled reminders and hides repeat reminder controls when editing quiet subscriptions", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: -2, repeatReminderEnabled: true })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("switch", { name: "到期提醒" })).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "到期提醒" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重复提醒")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "间隔" })).not.toBeInTheDocument();
  });

  it("opens the date picker on the month of the selected field value", async () => {
    const user = userEvent.setup();
    const subscription: Subscription = {
      id: "sub-1",
      name: "OpenAI",
      logo: undefined,
      price: 20,
      currency: "USD",
      billingCycle: "monthly",
      customDays: undefined,
      customCycleUnit: undefined,
      category: "productivity",
      status: "active",
      publicHidden: false,
      pinned: false,
      paymentMethod: "alipay",
      startDate: assertDateOnly("2026-04-16"),
      nextBillingDate: assertDateOnly("2026-05-16"),
      autoRenew: false,
      autoCalculateNextBillingDate: false,
      trialEndDate: undefined,
      website: undefined,
      notes: undefined,
      reminderDays: 3,
      tags: [],
      repeatReminderEnabled: true,
      repeatReminderInterval: "1h",
      repeatReminderWindow: "72h",
    };

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={subscription}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: /2026年4月16日/ }));

    expect(await screen.findByRole("button", { name: "2026年" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "四月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2026年4月16日.*selected/ })).toBeInTheDocument();
  });

  it("shows an inline error for historical subscriptions whose renewal date is before the start date", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({
            startDate: assertDateOnly("2026-05-14"),
            nextBillingDate: assertDateOnly("2026-05-13"),
            autoCalculateNextBillingDate: false,
          })}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(screen.getByText("到期日期不能早于开始日期")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables manual renewal dates before the selected start date", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({
            startDate: assertDateOnly("2026-05-14"),
            nextBillingDate: assertDateOnly("2026-05-20"),
            autoCalculateNextBillingDate: false,
          })}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: /2026年5月20日/ }));

    expect(await screen.findByRole("button", { name: "五月" })).toBeInTheDocument();
    const calendar = screen.getByRole("grid");
    expect(within(calendar).getByRole("button", { name: /2026年5月13日/ })).toBeDisabled();
    expect(within(calendar).getByRole("button", { name: /2026年5月14日/ })).not.toBeDisabled();
  });

  it("shows website and notes fields for an edited subscription", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({
            website: "https://billing.example.com",
            notes: "团队年度订阅",
          })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("网站")).toHaveValue("https://billing.example.com");
    expect(screen.getByLabelText("备注")).toHaveValue("团队年度订阅");
  });

  it("reuses existing tags and creates new tags when editing", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({ tags: ["Infra"] })}
          availableTags={["Security", "Docs", "Infra"]}
        />
      </TooltipProvider>,
    );

    const tagInput = screen.getByLabelText("标签");
    expect(screen.getByText("Infra")).toBeInTheDocument();

    await user.click(tagInput);
    await user.click(await screen.findByText("Security"));
    const refreshedTagInput = screen.getByLabelText("标签");
    await user.type(refreshedTagInput, "AI");
    expect(refreshedTagInput).toHaveValue("AI");
    await user.keyboard("{Enter}");
    await user.type(refreshedTagInput, "Infra");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tags: ["Infra", "Security", "AI"],
    }));
  });

  it("commits pending tag text when submitting without Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({ tags: ["Infra"] })}
          availableTags={["Infra"]}
        />
      </TooltipProvider>,
    );

    await user.type(screen.getByLabelText("标签"), "AI");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tags: ["Infra", "AI"],
    }));
  });

  it("removes an edited tag chip before submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({ tags: ["Infra", "Security"] })}
          availableTags={["Infra", "Security"]}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "移除标签 Infra" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tags: ["Security"],
    }));
  });

  it("submits edited website and notes while preserving the subscription id", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({
            id: "sub-edit-website-notes",
            website: "https://old.example.com",
            notes: "旧备注",
          })}
        />
      </TooltipProvider>,
    );

    await user.clear(screen.getByLabelText("网站"));
    await user.type(screen.getByLabelText("网站"), "https://new.example.com");
    await user.clear(screen.getByLabelText("备注"));
    await user.type(screen.getByLabelText("备注"), "新备注");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      id: "sub-edit-website-notes",
      website: "https://new.example.com",
      notes: "新备注",
    }));
  });

  it("shows repeat reminder controls when enabled for an edited subscription", () => {
    const subscription: Subscription = {
      id: "sub-1",
      name: "Critical SaaS",
      logo: undefined,
      price: 99,
      currency: "USD",
      billingCycle: "monthly",
      customDays: undefined,
      customCycleUnit: undefined,
      category: "productivity",
      status: "active",
      publicHidden: false,
      pinned: false,
      paymentMethod: "alipay",
      startDate: assertDateOnly("2026-05-14"),
      nextBillingDate: assertDateOnly("2026-05-17"),
      autoRenew: false,
      autoCalculateNextBillingDate: false,
      trialEndDate: undefined,
      website: undefined,
      notes: undefined,
      reminderDays: 3,
      tags: [],
      repeatReminderEnabled: true,
      repeatReminderInterval: "3h",
      repeatReminderWindow: "full",
    };

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={subscription}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("重复提醒")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "间隔" })).toHaveTextContent("每 3 小时");
    expect(screen.getByRole("combobox", { name: "重复范围" })).toHaveTextContent("从首次提醒后开始");
  });

  it("explains repeat reminders from the first reminder when the range covers the lead time", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: 1 })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("首次提醒后，每 1 小时重复一次，直到到期日通知时间。")).toBeInTheDocument();
  });

  it("explains that repeats only run in the final range when the lead time is longer", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: 30 })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("首次提醒照常发送，重复提醒只在到期前最后 72 小时内发送。")).toBeInTheDocument();
  });
});
