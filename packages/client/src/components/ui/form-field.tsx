/**
 * 表单字段组合原语。
 *
 * 架构位置：统一字段 label、说明、错误和 aria 关系；业务表单只负责提供校验结果和控件本体。
 */
import type { HTMLAttributes, ReactNode } from "react";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function formFieldDescribedBy(...ids: Array<string | false | null | undefined>) {
  const value = ids.filter((id): id is string => typeof id === "string" && id.length > 0).join(" ");
  return value || undefined;
}

export interface FormFieldRenderProps {
  id: string;
  errorId: string;
  descriptionId: string | undefined;
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FormFieldProps {
  id: string;
  label?: ReactNode | undefined;
  labelId?: string | undefined;
  labelSlot?: ReactNode | undefined;
  error?: ReactNode | undefined;
  errorId?: string | undefined;
  description?: ReactNode | undefined;
  descriptionId?: string | undefined;
  describedBy?: string | undefined;
  className?: string | undefined;
  labelClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  errorClassName?: string | undefined;
  renderError?: boolean | undefined;
  children: (field: FormFieldRenderProps) => ReactNode;
}

export function FormField({
  id,
  label,
  labelId,
  labelSlot,
  error,
  errorId,
  description,
  descriptionId,
  describedBy,
  className,
  labelClassName,
  descriptionClassName,
  errorClassName,
  renderError = true,
  children,
}: FormFieldProps) {
  const resolvedErrorId = errorId ?? `${id}-error`;
  const resolvedDescriptionId = description ? (descriptionId ?? `${id}-description`) : undefined;
  const field = {
    id,
    errorId: resolvedErrorId,
    descriptionId: resolvedDescriptionId,
    describedBy: formFieldDescribedBy(describedBy, resolvedDescriptionId, error ? resolvedErrorId : undefined),
    invalid: Boolean(error),
  } satisfies FormFieldRenderProps;

  return (
    <div data-slot="form-field" className={cn("grid gap-2", className)}>
      {labelSlot ?? (
        label ? (
          <Label id={labelId} htmlFor={id} className={labelClassName}>
            {label}
          </Label>
        ) : null
      )}
      {children(field)}
      {description ? (
        <p id={resolvedDescriptionId} className={cn("text-xs text-muted-foreground", descriptionClassName)}>
          {description}
        </p>
      ) : null}
      {renderError ? <FieldError id={resolvedErrorId} message={error} className={errorClassName} /> : null}
    </div>
  );
}

export interface FormFieldRowError {
  id: string;
  message?: ReactNode | undefined;
  className?: string | undefined;
}

export interface FormFieldRowProps extends HTMLAttributes<HTMLDivElement> {
  rowClassName?: string | undefined;
  errors?: FormFieldRowError[] | undefined;
}

export function FormFieldRow({
  children,
  className,
  rowClassName,
  errors = [],
  ...props
}: FormFieldRowProps) {
  const visibleErrors = errors.filter((item) => Boolean(item.message));

  return (
    <div data-slot="form-field-row" className={cn("grid", visibleErrors.length > 0 && "gap-2", className)} {...props}>
      <div className={cn("grid gap-4", rowClassName)}>{children}</div>
      {visibleErrors.length > 0 ? (
        <div className="grid gap-1">
          {visibleErrors.map((item) => (
            <FieldError key={item.id} id={item.id} message={item.message} className={item.className} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
