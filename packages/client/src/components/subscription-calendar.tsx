/**
 * 续费日历月视图入口（subscription-calendar.tsx）。
 *
 * 架构位置：这里持有当前月份、选中订阅和单日列表状态，负责把订阅
 * 将 DateOnly 分组为日历网格；详情弹窗拆到 subscription-calendar-dialogs.tsx。
 *
 * 注意： nextBillingDate 已经是 DateOnly，分组时不能重新用 Date 解析，
 * 否则浏览器时区会导致续费日期跨日。
 */

import { useState, useMemo } from 'react';
import type { Subscription } from '@/types/subscription';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useExchangeRates } from '@/hooks/use-exchange-rates';
import { useSettings } from '@/hooks/use-settings';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  setMonth,
  setYear
} from 'date-fns';
import { cn } from '@/lib/utils';
import { dateToDateOnly, isSameMonthDateOnly } from '@/lib/time/date-only';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/i18n/I18nProvider';
import { DaySubscriptionsDialog, SubscriptionDetailDialog } from './subscription-calendar-dialogs';
import type { CalendarDaySubscriptions } from './subscription-calendar-dialogs';

interface SubscriptionCalendarProps {
  /** 订阅列表（前端 domain 类型）。 */
  subscriptions: Subscription[];
  /** 点击“编辑”时回调（由上层页面打开编辑弹窗）。 */
  onEditSubscription?: (subscription: Subscription) => void;
}

const WEEKDAY_REFERENCE_DATES = [
  new Date(2024, 0, 1),
  new Date(2024, 0, 2),
  new Date(2024, 0, 3),
  new Date(2024, 0, 4),
  new Date(2024, 0, 5),
  new Date(2024, 0, 6),
  new Date(2024, 0, 7),
] as const;


/** 续费日历组件。 */
export const SubscriptionCalendar = ({ subscriptions, onEditSubscription }: SubscriptionCalendarProps) => {
  const { t, formatDateTime, formatCurrency } = useI18n();
  // 默认货币来自 Settings（持久化到 SQLite），用于日历底部“预计支出”的换算口径。
  const { data: settings } = useSettings();
  const defaultCurrency = settings?.defaultCurrency ?? 'CNY';
  const { convert, getCurrencySymbol } = useExchangeRates(settings?.exchangeRateProvider);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dayListOpen, setDayListOpen] = useState(false);
  const [selectedDaySubs, setSelectedDaySubs] = useState<CalendarDaySubscriptions | null>(null);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [yearRangeStart, setYearRangeStart] = useState(() => Math.floor(new Date().getFullYear() / 12) * 12);
  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, index) => formatDateTime(new Date(2024, index, 1), { month: "long" })),
    [formatDateTime],
  );
  const weekdayLabels = useMemo(
    () => WEEKDAY_REFERENCE_DATES.map((date) => formatDateTime(date, { weekday: "short" })),
    [formatDateTime],
  );

  // 将订阅按 “YYYY-MM-DD” 分组（同一天可能有多条订阅）。订阅日期已经是 DateOnly，
  // 这里不能再用 Date 解析，否则不同浏览器/服务器时区会让日历跨日。
  const subscriptionsByDate = useMemo(() => {
    const map = new Map<string, Subscription[]>();
    
    subscriptions
      .filter(sub => sub.status === 'active' || sub.status === 'trial')
      .forEach(sub => {
        const dateKey = sub.nextBillingDate;
        const existing = map.get(dateKey) || [];
        map.set(dateKey, [...existing, sub]);
      });
    
    return map;
  }, [subscriptions]);

  /**
   * 日历底部汇总：本月续费订阅数量 + 预计支出（换算到 defaultCurrency）。
   *
   * 说明：
   * - 预计支出按“本月发生续费”的订阅做一次性扣费汇总（不做月度折算）
   * - 汇率来自 useExchangeRates（缓存优先；失败时 fallback 到内置汇率）
   */
  const monthlySummary = useMemo(() => {
    let renewalsCount = 0;
    let estimatedSpending = 0;

    for (const [dateKey, daySubs] of subscriptionsByDate.entries()) {
      if (!isSameMonthDateOnly(dateKey, dateToDateOnly(currentMonth))) continue;

      renewalsCount += daySubs.length;
      for (const sub of daySubs) {
        estimatedSpending += convert(sub.price, sub.currency, defaultCurrency);
      }
    }

    return { renewalsCount, estimatedSpending };
  }, [subscriptionsByDate, currentMonth, convert, defaultCurrency]);

  // 生成当前月视图需要展示的日期网格（包含前后补齐的周）
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    
    // 续费日历以周一为一周起点，和中文/欧洲常见账单视图保持一致。
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const goToPreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const goToNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const goToToday = () => setCurrentMonth(new Date());

  const handleSubscriptionClick = (sub: Subscription) => {
    setSelectedSubscription(sub);
    setDetailOpen(true);
  };

  const handleShowDayList = (date: Date, subs: Subscription[]) => {
    setSelectedDaySubs({ date, subscriptions: subs });
    setDayListOpen(true);
  };

  const handleSelectFromList = (sub: Subscription) => {
    setDayListOpen(false);
    setSelectedSubscription(sub);
    setDetailOpen(true);
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">{t("calendar.title")}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToToday}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.today")}
            </Button>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={goToPreviousMonth}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              {/* 年份选择器 */}
              <Popover open={yearPickerOpen} onOpenChange={setYearPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-sm font-medium hover:bg-secondary"
                  >
                    {formatDateTime(currentMonth, { year: "numeric" })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-3" align="center">
                  <div className="flex items-center justify-between mb-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setYearRangeStart(prev => prev - 12)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary hover:text-primary"
                      onClick={() => {
                        const today = new Date();
                        setCurrentMonth(today);
                        setYearRangeStart(Math.floor(today.getFullYear() / 12) * 12);
                        setYearPickerOpen(false);
                      }}
                    >
                      {t("common.today")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setYearRangeStart(prev => prev + 12)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {Array.from({ length: 12 }, (_, i) => {
                      const year = yearRangeStart + i;
                      const isSelected = year === currentMonth.getFullYear();
                      const isCurrent = year === new Date().getFullYear();
                      return (
                        <button
                          key={year}
                          onClick={() => {
                            setCurrentMonth(setYear(currentMonth, year));
                            setYearPickerOpen(false);
                          }}
                          className={cn(
                            "h-9 rounded-lg text-sm font-medium transition-all",
                            isSelected 
                              ? "bg-primary text-primary-foreground" 
                              : isCurrent
                                ? "bg-accent text-accent-foreground hover:bg-accent/80"
                                : "hover:bg-secondary text-foreground"
                          )}
                        >
                          {year}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* 月份选择器 */}
              <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-sm font-medium hover:bg-secondary"
                  >
                    {formatDateTime(currentMonth, { month: "long" })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-3" align="center">
                  <div className="flex items-center justify-center mb-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary hover:text-primary"
                      onClick={() => {
                        setCurrentMonth(new Date());
                        setMonthPickerOpen(false);
                      }}
                    >
                      {t("common.today")}
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {monthLabels.map((month, index) => {
                      const isSelected = index === currentMonth.getMonth();
                      const isCurrent = index === new Date().getMonth() && 
                                       currentMonth.getFullYear() === new Date().getFullYear();
                      return (
                        <button
                          key={month}
                          onClick={() => {
                            setCurrentMonth(setMonth(currentMonth, index));
                            setMonthPickerOpen(false);
                          }}
                          className={cn(
                            "h-9 rounded-lg text-sm font-medium transition-all",
                            isSelected 
                              ? "bg-primary text-primary-foreground" 
                              : isCurrent
                                ? "bg-accent text-accent-foreground hover:bg-accent/80"
                                : "hover:bg-secondary text-foreground"
                          )}
                        >
                          {month}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={goToNextMonth}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 星期标题 */}
        <div className="grid grid-cols-7 mb-2">
          {weekdayLabels.map((day) => (
            <div
              key={day}
              className="text-center text-xs font-medium text-muted-foreground py-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* 日历网格 */}
        <div className="grid grid-cols-7 gap-px bg-border/50 rounded-lg overflow-hidden">
          {calendarDays.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const daySubs = subscriptionsByDate.get(dateKey) || [];
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isDayToday = isToday(day);

            return (
              <div
                key={dateKey}
                className={cn(
                  "min-h-[80px] bg-card p-1.5 transition-colors",
                  !isCurrentMonth && "bg-muted/30"
                )}
              >
                {/* 日期数字 */}
                <div className="flex justify-end mb-1">
                  <span
                    className={cn(
                      "text-xs w-6 h-6 flex items-center justify-center rounded-full",
                      isDayToday && "bg-primary text-primary-foreground font-semibold",
                      !isDayToday && isCurrentMonth && "text-foreground",
                      !isDayToday && !isCurrentMonth && "text-muted-foreground/50"
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>

                {/* 订阅项 */}
                <div className="grid gap-0.5">
                  <TooltipProvider delayDuration={200}>
                    {daySubs.slice(0, 2).map((sub) => (
                      <Tooltip key={sub.id}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleSubscriptionClick(sub)}
                            className={cn(
                              "w-full text-left text-xs px-1.5 py-0.5 rounded border truncate transition-colors",
                              "bg-background hover:bg-secondary/60 border-border text-foreground",
                              "cursor-pointer hover:border-border"
                            )}
                          >
                            {sub.name}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-medium">{sub.name}</p>
                          <p className="text-muted-foreground">
                            {getCurrencySymbol(sub.currency)}{sub.price}
                          </p>
                          <p className="text-muted-foreground/70">{t("calendar.viewDetails")}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                    {daySubs.length > 2 && (
                      <button 
                        onClick={() => handleShowDayList(day, daySubs)}
                        className="w-full text-xs text-primary hover:text-primary-glow text-center cursor-pointer hover:underline"
                      >
                        {t("calendar.more", { count: daySubs.length - 2 })}
                      </button>
                    )}
                  </TooltipProvider>
                </div>
              </div>
            );
          })}
        </div>

        {/* 月度汇总 */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("calendar.monthlyRenewals")}</span>
              <p className="font-semibold text-foreground mt-1">
                {t("calendar.renewalCount", { count: monthlySummary.renewalsCount })}
              </p>
            </div>
            <div className="text-sm text-right">
              <span className="text-muted-foreground">{t("calendar.estimatedSpend")}</span>
              <p className="font-semibold text-foreground mt-1">
                {formatCurrency(monthlySummary.estimatedSpending, defaultCurrency)}
              </p>
            </div>
          </div>
        </div>
      </div>


      <SubscriptionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        subscription={selectedSubscription}
        onEditSubscription={onEditSubscription}
      />

      <DaySubscriptionsDialog
        open={dayListOpen}
        onOpenChange={setDayListOpen}
        selectedDaySubs={selectedDaySubs}
        onSelectSubscription={handleSelectFromList}
      />
    </>
  );
};
