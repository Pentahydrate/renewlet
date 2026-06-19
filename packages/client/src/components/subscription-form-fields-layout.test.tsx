import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import { createSubscriptionFormState } from "@/types/subscription-form";
import { SubscriptionFormFields, type SubscriptionFormErrors } from "./subscription-form-fields";

const config = {
  categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
  statuses: [{ id: "active", value: "active", labels: { "zh-CN": "活跃", "en-US": "Active" } }],
  paymentMethods: [{ id: "alipay", value: "alipay", labels: { "zh-CN": "支付宝", "en-US": "Alipay" } }],
  currencies: [
    { id: "CNY", value: "CNY", labels: { "zh-CN": "¥ 人民币 (CNY)", "en-US": "¥ Chinese Yuan (CNY)" }, enabled: true },
    { id: "USD", value: "USD", labels: { "zh-CN": "$ 美元 (USD)", "en-US": "$ US Dollar (USD)" }, enabled: true },
  ],
};

function Harness({ errors }: { errors: SubscriptionFormErrors }) {
  const [formData, setFormData] = useState(() => createSubscriptionFormState({
    currency: "CNY",
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2026-02-01"),
  }));

  return (
    <TooltipProvider delayDuration={0}>
      <SubscriptionFormFields
        idPrefix=""
        config={config}
        formData={formData}
        setFormData={setFormData}
        showLogoField={false}
        onLogoUploadStatusChange={vi.fn()}
        errors={errors}
        notificationReminderDays={5}
      />
    </TooltipProvider>
  );
}

describe("SubscriptionFormFields layout", () => {
  it("renders price and currency errors at row level instead of inside one column", () => {
    render(<Harness errors={{ price: "请输入价格" }} />);

    const priceInput = screen.getByPlaceholderText("0.00");
    const priceField = priceInput.closest('[data-slot="form-field"]');
    const priceRow = priceInput.closest('[data-slot="form-field-row"]');
    const error = screen.getByRole("alert");

    expect(priceInput).toHaveAttribute("aria-describedby", "price-error");
    expect(error).toHaveAttribute("id", "price-error");
    expect(priceField).not.toContainElement(error);
    expect(priceRow).toContainElement(error);
  });
});
