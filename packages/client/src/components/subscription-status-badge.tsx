import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type SubscriptionStatus } from "@/types/subscription";

// 状态色只表达账本语义，不参与续订算法；expired/cancelled 都用风险色提醒用户需要处理。
const statusBadgeClassNames = {
  trial: "border-warning/20 bg-warning/10 text-warning",
  active: "border-success/20 bg-success/10 text-success",
  expired: "border-destructive/20 bg-destructive/10 text-destructive",
  paused: "border-muted bg-muted text-muted-foreground",
  cancelled: "border-destructive/20 bg-destructive/10 text-destructive",
} satisfies Record<SubscriptionStatus, string>;

interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
  className?: string | undefined;
}

export function SubscriptionStatusBadge({ status, className }: SubscriptionStatusBadgeProps) {
  const { label } = useI18n();

  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 whitespace-nowrap text-xs", statusBadgeClassNames[status], className)}
    >
      {label(STATUS_LABELS[status])}
    </Badge>
  );
}
