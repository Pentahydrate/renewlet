/**
 * 订阅表单本地状态类型。
 *
 * 架构位置：表单组件使用字符串状态适配输入控件，提交边界再转换为
 * `SubscriptionDraft/Subscription` 领域模型。
 *
 * 注意： 这里允许的空字符串是 UI 中间态；不要把该类型直接传给 API 写入层。
 */
import type {
  BillingCycle,
  Category,
  PaymentMethod,
  RepeatReminderInterval,
  RepeatReminderWindow,
  SubscriptionStatus,
} from "@/types/subscription";
import type { DateOnly } from "@/lib/time/date-only";

/**
 * 订阅表单提醒类型：
 * - preset：使用预设提醒天数（下拉选项）
 * - custom：使用自定义提醒天数（输入框）
 */
export type SubscriptionFormReminderType = "preset" | "custom";

/**
 * 订阅表单的本地状态（UI 输入专用）。
 *
 * 说明：
 * - 这里的 `price/customDays/reminderDays/...` 使用 string，是为了直接绑定 `<input />` 的 value
 * - 最终提交时（新增/编辑）会转换为业务模型所需的 `number | DateOnly | undefined`
 */
export type SubscriptionFormState = {
  /** 订阅名称（必填）。 */
  name: string;
  /** Logo（可选，URL 或 data URL）。 */
  logo: string | undefined;
  /** 金额输入框字符串（提交时 parseFloat）。 */
  price: string;
  /** 货币代码（如：CNY、USD）。 */
  currency: string;
  /** 扣费周期。 */
  billingCycle: BillingCycle;
  /** 自定义周期天数（字符串，仅 billingCycle=custom 时启用）。 */
  customDays: string;
  /** 分类。 */
  category: Category;
  /** 状态。 */
  status: SubscriptionStatus;
  /** 支付方式（空字符串表示“未选择”）。 */
  paymentMethod: PaymentMethod | "";
  /** 开始日期（date-only，UI 日历边界才临时转 Date）。 */
  startDate: DateOnly | undefined;
  /** 下次扣费日期（date-only，UI 日历边界才临时转 Date）。 */
  nextBillingDate: DateOnly | undefined;
  /** 是否自动根据开始日期 + 周期推算 nextBillingDate。 */
  autoCalculate: boolean;
  /** 到期提醒类型：预设天数 or 自定义天数。 */
  reminderType: SubscriptionFormReminderType;
  /** 预设提醒天数（字符串，提交时 parseInt）。 */
  reminderDays: string;
  /** 自定义提醒天数（字符串，提交时 parseInt）。 */
  customReminderDays: string;
  /** 是否为重要订阅开启重复提醒。 */
  repeatReminderEnabled: boolean;
  /** 重复提醒间隔。 */
  repeatReminderInterval: RepeatReminderInterval;
  /** 重复提醒窗口。 */
  repeatReminderWindow: RepeatReminderWindow;
  /** 官网链接输入（可选）。 */
  website: string;
  /** 备注输入（可选）。 */
  notes: string;
  /** 标签数组；输入组件负责把用户键入的分隔文本归并为数组。 */
  tags: string[];
};

/**
 * 创建表单初始值（用于新增/编辑复用）。
 *
 * 说明：
 * - 默认值以“新增订阅”表单为准；编辑时可用 overrides 覆盖（例如 autoCalculate=false）
 */
export function createSubscriptionFormState(
  overrides: Partial<SubscriptionFormState> = {},
): SubscriptionFormState {
  return {
    name: "",
    logo: undefined,
    price: "",
    currency: "CNY",
    billingCycle: "monthly",
    customDays: "",
    category: "productivity",
    status: "active",
    paymentMethod: "",
    startDate: undefined,
    nextBillingDate: undefined,
    autoCalculate: true,
    reminderType: "preset",
    reminderDays: "3",
    customReminderDays: "",
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    website: "",
    notes: "",
    tags: [],
    ...overrides,
  };
}
