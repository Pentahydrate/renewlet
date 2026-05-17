/**
 * 即将续费列表（侧边栏卡片）。
 *
 * 规则：
 * - 只展示 active/trial
 * - 取未来 14 天内的续费
 * - 最多展示 5 条
 *
 * 注意： 这是仪表盘提示窗口，不等同于通知 Cron 的 reminderDays 规则。
 */

import { Subscription } from '@/types/subscription';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { daysBetweenDateOnly, formatDateOnlyMonthDay, todayDateOnlyInTimeZone } from '@/lib/time/date-only';
import { useI18n } from '@/i18n/I18nProvider';

interface UpcomingRenewalsProps {
  /** 订阅列表（前端 domain 类型）。 */
  subscriptions: Subscription[];
  /** 用户 IANA 时区，用于“今天/未来两周”窗口。 */
  timeZone: string;
}

/** 即将续费列表组件。 */
export function UpcomingRenewals({ subscriptions, timeZone }: UpcomingRenewalsProps) {
  const { t, formatCurrency, locale } = useI18n();
  const today = todayDateOnlyInTimeZone(new Date(), timeZone);
  const upcoming = subscriptions
    .filter(s => s.status === 'active' || s.status === 'trial')
    .map(s => ({
      ...s,
      daysUntil: daysBetweenDateOnly(today, s.nextBillingDate),
    }))
    .filter(s => s.daysUntil >= 0 && s.daysUntil <= 14)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5);

  if (upcoming.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <Clock className="h-6 w-6 text-success" />
        </div>
        <p className="text-sm text-muted-foreground">{t("upcoming.noneNextTwoWeeks")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {upcoming.map((sub) => (
        <div
          key={sub.id}
          className={cn(
            "flex items-center justify-between rounded-lg border border-border bg-secondary/50 p-4 transition-colors hover:bg-secondary",
            sub.daysUntil <= 3 && "border-warning/30 bg-warning/5"
          )}
        >
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold",
              sub.daysUntil <= 3 
                ? "bg-warning/20 text-warning" 
                : "bg-muted text-muted-foreground"
            )}>
              {sub.daysUntil === 0 ? t("upcoming.todayShort") : t("upcoming.daysShort", { days: sub.daysUntil })}
            </div>
            <div>
              <p className="font-medium text-foreground">{sub.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateOnlyMonthDay(sub.nextBillingDate, locale)}
              </p>
            </div>
          </div>
          <p className="font-semibold text-foreground">
            {formatCurrency(sub.price, sub.currency)}
          </p>
        </div>
      ))}
    </div>
  );
}
