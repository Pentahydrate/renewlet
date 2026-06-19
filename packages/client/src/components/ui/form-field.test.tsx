import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField, FormFieldRow } from "./form-field";

describe("FormField", () => {
  it("connects description and field errors without rendering empty error slots", () => {
    const { rerender } = render(
      <FormField id="amount" label="Amount" description="Monthly amount">
        {(field) => (
          <input
            id={field.id}
            aria-invalid={field.invalid}
            aria-describedby={field.describedBy}
          />
        )}
      </FormField>,
    );

    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).toHaveAttribute("aria-describedby", "amount-description");
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <FormField id="amount" label="Amount" description="Monthly amount" error="Enter an amount">
        {(field) => (
          <input
            id={field.id}
            aria-invalid={field.invalid}
            aria-describedby={field.describedBy}
          />
        )}
      </FormField>,
    );

    expect(screen.getByLabelText("Amount")).toHaveAttribute(
      "aria-describedby",
      "amount-description amount-error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
  });
});

describe("FormFieldRow", () => {
  it("renders row-level messages only when a field has an error", () => {
    const { rerender } = render(
      <FormFieldRow rowClassName="sm:grid-cols-2" errors={[{ id: "price-error" }]}>
        <input aria-label="Price" />
        <input aria-label="Currency" />
      </FormFieldRow>,
    );

    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <FormFieldRow rowClassName="sm:grid-cols-2" errors={[{ id: "price-error", message: "Enter a price" }]}>
        <input aria-label="Price" />
        <input aria-label="Currency" />
      </FormFieldRow>,
    );

    expect(screen.getByRole("alert")).toHaveAttribute("id", "price-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a price");
  });
});
