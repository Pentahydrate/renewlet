/**
 * 订阅账单周期计算工具。
 *
 * 架构位置：
 * - 表单自动计算下次扣费日。
 * - 仪表盘/统计页把不同周期统一折算到月度口径。
 *
 * 注意： 这里不做汇率换算；金额币种归一化由统计模型处理。
 */
import type { BillingCycle } from "@/types/subscription";
import { addDateOnly, compareDateOnly, type DateOnly } from "@/lib/time/date-only";

/**
 * 根据开始日期 + 周期计算“下一次扣费日期”。
 *
 * 规则：
 * - 未传 referenceDate 时，从 startDate 起加一个扣费周期，得到当前订阅周期的到期/下次扣费日期
 * - 传入 referenceDate 时，按 startDate 锚定周期，返回 referenceDate 当天或之后最近一次扣费日
 * - 自定义周期（custom）使用 customDays（默认 30 天）
 *
 * 注意：
 * - 这是纯函数：不会修改传入的 Date 对象
 * - UI 侧（新增/编辑订阅）都依赖该计算逻辑，集中到一个文件便于统一维护
 */
export function calculateNextBillingDate(
  startDate: DateOnly,
  cycle: BillingCycle,
  customDays?: number,
  referenceDate?: DateOnly,
): DateOnly {
  if (referenceDate) {
    let cycleCount = 1;
    let candidate = addBillingCycles(startDate, cycle, cycleCount, customDays);
    while (compareDateOnly(candidate, referenceDate) < 0) {
      cycleCount += 1;
      candidate = addBillingCycles(startDate, cycle, cycleCount, customDays);
    }
    return candidate;
  }

  return addBillingCycles(startDate, cycle, 1, customDays);
}

function addBillingCycles(
  startDate: DateOnly,
  cycle: BillingCycle,
  cycleCount: number,
  customDays?: number,
): DateOnly {
  switch (cycle) {
    case "weekly":
      return addDateOnly(startDate, { weeks: cycleCount });
    case "monthly":
      return addDateOnly(startDate, { months: cycleCount });
    case "quarterly":
      return addDateOnly(startDate, { months: 3 * cycleCount });
    case "semi-annual":
      return addDateOnly(startDate, { months: 6 * cycleCount });
    case "annual":
      return addDateOnly(startDate, { years: cycleCount });
    case "custom":
      return addDateOnly(startDate, { days: (customDays || 30) * cycleCount });
    default:
      return addDateOnly(startDate, { months: cycleCount });
  }
}

/**
 * 将“单次扣费金额”折算为“月度金额”（不含汇率换算）。
 *
 * 说明：
 * - 该函数只做周期折算，不关心货币；如果需要统一口径，请先做汇率换算再折算（月度是线性变换，顺序无关）
 * - 目前项目里多个页面（仪表盘/统计/饼图）都需要这套折算规则，集中到这里便于统一维护
 *
 * 注意： weekly 使用 4.33 是产品口径近似值，不等同于精确自然月账单。
 */
export function toMonthlyAmount(amount: number, cycle: BillingCycle, customDays?: number): number {
  switch (cycle) {
    case "weekly":
      return amount * 4.33;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "semi-annual":
      return amount / 6;
    case "annual":
      return amount / 12;
    case "custom":
      return customDays ? (amount / customDays) * 30 : amount;
    default:
      return amount;
  }
}
