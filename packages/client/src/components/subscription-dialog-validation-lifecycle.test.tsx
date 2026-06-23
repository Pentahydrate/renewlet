import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SubscriptionDraft } from "@/types/subscription";
import { SubscriptionDialog } from "./subscription-dialog";

const mocks = vi.hoisted(() => ({
  config: {
    categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
    statuses: [{ id: "active", value: "active", labels: { "zh-CN": "活跃", "en-US": "Active" } }],
    paymentMethods: [{ id: "alipay", value: "alipay", labels: { "zh-CN": "支付宝", "en-US": "Alipay" } }],
    currencies: [
      { id: "CNY", value: "CNY", labels: { "zh-CN": "¥ 人民币 (CNY)", "en-US": "¥ Chinese Yuan (CNY)" }, enabled: true },
      { id: "USD", value: "USD", labels: { "zh-CN": "$ 美元 (USD)", "en-US": "$ US Dollar (USD)" }, enabled: true },
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

describe("SubscriptionDialog validation lifecycle", () => {
  it("clears stale date validation when billing cycle changes after a failed create submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(subscription: SubscriptionDraft) => void>();

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

    await user.click(screen.getByRole("button", { name: "添加订阅" }));
    expect(screen.getByText("请选择到期日期")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "扣费周期" }));
    await user.click(await screen.findByRole("option", { name: "一次性购买" }));

    const purchaseDateButton = document.getElementById("startDate");
    if (!(purchaseDateButton instanceof HTMLButtonElement)) {
      throw new Error("Purchase date button was not rendered");
    }
    expect(screen.queryByText("请选择到期日期")).not.toBeInTheDocument();
    expect(purchaseDateButton).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByText("金额必须是 0 到 1,000,000,000 之间的有效数字")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    const purchaseDateError = screen.getByText("请选择购买日期");
    expect(purchaseDateButton).toHaveAttribute("aria-invalid", "true");
    expect(purchaseDateButton.getAttribute("aria-describedby")?.split(" ")).toContain("startDate-error");
    expect(purchaseDateButton.closest('[data-slot="form-field"]')).toContainElement(purchaseDateError);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
