/**
 * 支出分布饼图组件（按分类）。
 *
 * 说明：
 * - 使用 `useExchangeRates()` 做实时汇率换算，统一换算到“统计货币”（Settings → defaultCurrency）
 * - 再按扣费周期折算为“月度支出”，用于分类占比展示
 *
 * 注意： 该组件仍直接读取 settings/customConfig。若继续推进模块化，应把图表 view model
 * 从上层传入，避免展示组件隐式依赖全局 Context。
 * PERF： Recharts tooltip payload 来自第三方库，保持 unknown 入口并做窄化，避免为了图表库内部结构扩宽全局类型。
 */

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { Subscription } from '@/types/subscription';
import { toMonthlyAmount } from '@/lib/subscription-billing';
import { useExchangeRates } from '@/hooks/use-exchange-rates';
import { useSettings } from '@/hooks/use-settings';
import { useMemo } from 'react';
import { useCustomConfig } from '@/contexts/CustomConfigContext';
import { useI18n } from '@/i18n/I18nProvider';

interface SpendingChartProps {
  /** 订阅列表（前端 domain 类型）。 */
  subscriptions: Subscription[];
}

/** 图表回退色板：当某个分类未配置颜色时使用。 */
const FALLBACK_COLORS = [
  'hsl(160 84% 45%)',
  'hsl(200 80% 50%)',
  'hsl(280 70% 55%)',
  'hsl(35 90% 55%)',
  'hsl(350 75% 55%)',
  'hsl(180 60% 45%)',
  'hsl(45 90% 50%)',
  'hsl(320 70% 55%)',
];

function fallbackColorAt(index: number): string {
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length] ?? 'hsl(160 84% 45%)';
}

type ChartTooltipPayload = {
  value?: unknown;
  name?: unknown;
};

type ChartTooltipProps = {
  active: boolean;
  payload: readonly ChartTooltipPayload[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readChartTooltipProps(value: unknown): ChartTooltipProps {
  // Recharts 的 tooltip props 在类型层不够稳定；这里做最小结构读取，避免 UI 因第三方 payload 漂移而崩溃。
  if (!isRecord(value)) return { active: false, payload: [] };
  const payload = Array.isArray(value["payload"])
    ? value["payload"].filter(isRecord)
    : [];
  return {
    active: value["active"] === true,
    payload,
  };
}

/** 支出分布图（按分类）。 */
export function SpendingChart({ subscriptions }: SpendingChartProps) {
  const { data: settings } = useSettings();
  const { config } = useCustomConfig();
  const { t, label, formatCurrency } = useI18n();
  const defaultCurrency = settings?.defaultCurrency ?? "CNY";
  const { convert } = useExchangeRates(settings?.exchangeRateProvider);

  const categoryByValue = useMemo(() => {
    return new Map(config.categories.map((c) => [c.value, c]));
  }, [config.categories]);

  const data = useMemo(() => {
    const activeSubscriptions = subscriptions.filter((s) => s.status === "active" || s.status === "trial");

    const categorySpending = activeSubscriptions.reduce(
      (acc, sub) => {
        // 先把单次扣费金额换算到统计货币，再折算为“月度金额”（与统计页/仪表盘一致）
        const amountInDefault = convert(sub.price, sub.currency, defaultCurrency);
        const monthly = toMonthlyAmount(amountInDefault, sub.billingCycle, sub.customDays);
        acc[sub.category] = (acc[sub.category] || 0) + monthly;
        return acc;
      },
      {} as Record<string, number>,
    );

    return Object.entries(categorySpending)
      .filter(([, value]) => value > 0)
      .map(([category, value], index) => {
        const categoryConfig = categoryByValue.get(category);
        return {
          name: categoryConfig ? label(categoryConfig.labels) : category,
          value: Math.round(value * 1000) / 1000,
          color: categoryConfig?.color ?? fallbackColorAt(index),
        };
      });
  }, [categoryByValue, convert, defaultCurrency, label, subscriptions]);

  const CustomTooltip = ({ active, payload }: ChartTooltipProps) => {
    const first = payload?.[0];
    if (active && first) {
      const rawValue = first.value;
      const valueNumber = typeof rawValue === "number" ? rawValue : NaN;
      return (
        <div className="rounded-lg border border-border bg-popover px-4 py-3 shadow-lg">
          <p className="font-medium text-foreground">{typeof first.name === "string" || typeof first.name === "number" ? first.name : ""}</p>
          <p className="text-sm text-muted-foreground">
            {Number.isFinite(valueNumber) ? formatCurrency(valueNumber, defaultCurrency) : String(rawValue ?? '')} {t("statistics.perMonth")}
          </p>
        </div>
      );
    }
    return null;
  };

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        {t("statistics.noSubscriptionData")}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="56%"
              outerRadius="90%"
              paddingAngle={4}
              cornerRadius={4}
              dataKey="value"
              strokeWidth={0}
              // Recharts 饼图默认会做 SVG 动画，在部分设备上会导致首次渲染掉帧/卡顿；
              // 这里关闭“入场动画”，保持视觉样式不变，但显著降低初始化开销。
              isAnimationActive={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  className="transition-all duration-300 hover:opacity-80"
                />
              ))}
            </Pie>
            <Tooltip
              content={(props: unknown) => <CustomTooltip {...readChartTooltipProps(props)} />}
              isAnimationActive={false}
              offset={12}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ pointerEvents: "none" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2" role="list">
        {data.map((entry) => (
          <div key={entry.name} className="flex min-w-0 items-center gap-2" role="listitem">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span className="truncate text-sm text-muted-foreground">{entry.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
