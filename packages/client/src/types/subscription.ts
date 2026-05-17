/**
 * 订阅、设置与通知的前端领域模型。
 *
 * 架构位置：API/PocketBase 响应必须先经过 Zod schema 与 hook 边界，页面、统计、日历和通知设置
 * 只消费这里的品牌类型与联合类型。
 *
 * 注意： date-only、本地时间和 custom 周期是核心不变量；新增字段时要同步 Go schema/hooks 与前端 schema。
 */
import type { CustomThemeColor, ThemeMode, ThemeVariant } from './theme';
import { DEFAULT_CUSTOM_THEME_COLOR } from './theme';
import { getInitialLocale, labels, type Locale, type LocalizedLabels } from '@/i18n/locales';
import { SUPPORTED_EXCHANGE_RATE_CURRENCIES, getIntlCurrencyOptionLabel } from '@/lib/currency-data';
import type { ExchangeRateProvider } from '@/lib/api/schemas/exchange-rates';
import type { DateOnly } from '@/lib/time/date-only';
import type { LocalTime } from '@/lib/time/local-time';

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'paused', 'cancelled'] as const;
/** 订阅状态（影响展示、统计与提醒逻辑）。 */
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'semi-annual', 'annual', 'custom'] as const;
/** 扣费周期（用于计算月度/年度支出与续费日期）。 */
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const CATEGORIES = [
  'productivity',
  'entertainment',
  'lifestyle',
  'finance',
  'streaming',
  'music',
  'gaming',
  'utilities',
  'cloud_storage',
  'education',
  'health_fitness',
  'food_dining',
  'shopping',
  'travel',
  'business',
  'communication',
  'developer_tools',
  'design',
  'ai_tools',
  'security_vpn',
  'hosting_domains',
  'news_media',
  'other',
] as const;
/** 内置订阅分类（用于默认选项 + 视觉 token）。 */
export type BuiltInCategory = (typeof CATEGORIES)[number];
/**
 * 订阅分类值。
 *
 * 说明：
 * - `BuiltInCategory`：内置分类（有默认颜色 token）
 * - `(string & {})`：用户自定义分类（来自「设置 → 分类管理」）
 */
export type Category = BuiltInCategory | (string & {});

export const PAYMENT_METHODS = [
  'alipay',
  'wechat',
  'credit_card',
  'debit_card',
  'paypal',
  'apple_pay',
  'google_pay',
  'bank_transfer',
  'crypto',
  'other',
] as const;
/** 内置支付方式（默认 10 个，图标固定）。 */
export type BuiltInPaymentMethod = (typeof PAYMENT_METHODS)[number];
/**
 * 支付方式值。
 *
 * 说明：
 * - `BuiltInPaymentMethod`：内置支付方式（图标固定）
 * - `(string & {})`：用户自定义支付方式（来自「设置 → 支付方式管理」）
 */
export type PaymentMethod = BuiltInPaymentMethod | (string & {});

export const NOTIFICATION_CHANNELS = ['telegram', 'notifyx', 'webhook', 'wechat', 'email', 'bark'] as const;
/** 通知渠道（用于配置页选择 + 后续通知任务）。 */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const REPEAT_REMINDER_INTERVALS = ['1h', '3h', '6h', '12h', '24h'] as const;
/** 重复提醒间隔（按小时计，用于重要订阅的后续提醒）。 */
export type RepeatReminderInterval = (typeof REPEAT_REMINDER_INTERVALS)[number];

export const REPEAT_REMINDER_WINDOWS = ['24h', '48h', '72h', 'full'] as const;
/** 重复提醒窗口；full 表示从首次提醒后一直重复到目标日期通知时间。 */
export type RepeatReminderWindow = (typeof REPEAT_REMINDER_WINDOWS)[number];

/** 单个订阅允许的标签数量保护上限；正常使用体验上不主动强调。 */
export const MAX_SUBSCRIPTION_TAGS = 100;
/** 单个标签的后端契约长度上限。 */
export const MAX_SUBSCRIPTION_TAG_LENGTH = 40;

export const WEBHOOK_HEADERS_PLACEHOLDER = '{"Authorization": "Bearer your-token", "Content-Type": "application/json"}';
export const WEBHOOK_PAYLOAD_PLACEHOLDER = '{"title": "{title}", "content": "{content}", "timestamp": "{timestamp}"}';

interface SubscriptionBase {
  /** 订阅 ID（客户端使用字符串；数据库中为 UUID）。 */
  id: string;
  /** 订阅名称。 */
  name: string;
  /** Logo（可选）。 */
  logo: string | undefined;
  /** 单次扣费金额。 */
  price: number;
  /** 货币代码（如：CNY、USD）。 */
  currency: string;
  /** 分类。 */
  category: Category;
  /** 状态。 */
  status: SubscriptionStatus;
  /** 支付方式（可选）。 */
  paymentMethod: PaymentMethod | undefined;
  /** 下次扣费日期（用于提醒与日历）。 */
  nextBillingDate: DateOnly;
  /** 是否自动根据开始日期和扣费周期计算下次扣费日期。 */
  autoCalculateNextBillingDate: boolean;
  /** 开始日期。 */
  startDate: DateOnly;
  /** 试用结束日期（仅试用状态可选）。 */
  trialEndDate: DateOnly | undefined;
  /** 官网地址（可选）。 */
  website: string | undefined;
  /** 备注（可选）。 */
  notes: string | undefined;
  /** 标签。 */
  tags: string[];
  /** 提前多少天提醒（整数，>=0）。 */
  reminderDays: number;
  /** 是否为该订阅启用重复提醒。 */
  repeatReminderEnabled: boolean;
  /** 重复提醒间隔。 */
  repeatReminderInterval: RepeatReminderInterval;
  /** 重复提醒窗口。 */
  repeatReminderWindow: RepeatReminderWindow;
}

export interface CustomCycleSubscription extends SubscriptionBase {
  /** 自定义周期必须携带自定义天数；统计折算和自动续费日期计算都依赖这个不变量。 */
  billingCycle: "custom";
  customDays: number;
}

export interface FixedCycleSubscription extends SubscriptionBase {
  /** 固定周期不携带自定义天数，避免历史 customDays 脏值影响金额折算。 */
  billingCycle: Exclude<BillingCycle, "custom">;
  customDays: undefined;
}

export type Subscription = CustomCycleSubscription | FixedCycleSubscription;
export type SubscriptionDraft = Omit<CustomCycleSubscription, "id"> | Omit<FixedCycleSubscription, "id">;

export interface SubscriptionStats {
  /** 按月折算的总支出（基于订阅周期换算）。 */
  totalMonthly: number;
  /** 按年折算的总支出（基于订阅周期换算）。 */
  totalAnnual: number;
  /** 当前处于活跃状态的订阅数量。 */
  activeCount: number;
  /** 即将续费的订阅数量（时间窗口由 UI 逻辑决定）。 */
  upcomingRenewals: number;
  /** 试用即将结束的订阅数量（时间窗口由 UI 逻辑决定）。 */
  trialEndingSoon: number;
}

export interface AppSettings {
  // 管理员展示信息
  /** 管理员用户名（用于界面展示/未来扩展）。 */
  adminUsername: string;
  
  // 显示与本地化
  /** 明暗模式（light/dark/system，对应本地 ThemeProvider）。 */
  themeMode: ThemeMode;
  /** 主题风格（emerald/ocean/...，对应 html[data-theme]）。 */
  themeVariant: ThemeVariant;
  /** 自定义主题色（仅 themeVariant=custom 时生效）。 */
  themeCustomColor: CustomThemeColor;
  /** 界面、错误和通知使用的语言。 */
  locale: Locale;
  /** 通知内容中是否包含已过期订阅。 */
  showExpired: boolean;
  /** 默认货币（用于统计/展示换算）。 */
  defaultCurrency: string;
  /** 首选汇率来源；另一个远端来源仍作为兜底。 */
  exchangeRateProvider: ExchangeRateProvider;
  
  // 预算
  /** 月度预算（用于统计页预算占比）。 */
  monthlyBudget: number;
  
  // 时区
  /** 用户时区（用于后续定时任务/通知展示）。 */
  timezone: string;
  
  // 通知总开关
  /** 每天发送通知的本地墙上时间（格式 HH:mm，需结合 timezone 解释）。 */
  notificationTimeLocal: LocalTime;
  /** 启用的通知渠道（可多选）。 */
  enabledChannels: NotificationChannel[];
  /** 第三方 API 测试号码（部分渠道测试用）。 */
  testPhone: string;
  
  // Telegram 渠道
  /** Telegram Bot Token。 */
  telegramBotToken: string;
  /** Telegram Chat ID。 */
  telegramChatId: string;
  
  // Notifyx 渠道
  /** Notifyx API Key。 */
  notifyxApiKey: string;
  
  // Webhook 渠道
  /** Webhook URL。 */
  webhookUrl: string;
  /** Webhook 请求方法。 */
  webhookMethod: 'GET' | 'POST';
  /** Webhook Headers（JSON 字符串）。 */
  webhookHeaders: string;
  /** Webhook Payload（模板字符串/JSON 字符串）。 */
  webhookPayload: string;
  
  // 企业微信渠道
  /** 企业微信机器人 Webhook URL。 */
  wechatWebhookUrl: string;
  /** 企业微信消息类型。 */
  wechatMessageType: 'text' | 'markdown';
  /** 企业微信消息是否追加模式标签。 */
  wechatAddModeTag: boolean;
  /** 企业微信 @ 手机号（逗号分隔）。 */
  wechatAtPhones: string;
  /** 企业微信是否 @ 全体。 */
  wechatAtAll: boolean;
  
  // 邮件渠道
  /** SMTP 服务器地址。 */
  smtpHost: string;
  /** SMTP 端口。 */
  smtpPort: string;
  /** SMTP 是否使用 TLS 直连。 */
  smtpSecure: boolean;
  /** SMTP 用户名。 */
  smtpUser: string;
  /** SMTP 密码。 */
  smtpPassword: string;
  /** SMTP 发件人。 */
  smtpFrom: string;
  /** SMTP 回复地址。 */
  smtpReplyTo: string;
  /** 是否支持多收件人。 */
  notifyMultipleAddresses: boolean;
  /** 收件人邮箱。 */
  recipientEmail: string;
  
  // Bark 渠道
  /** Bark 服务器地址。 */
  barkServerUrl: string;
  /** Bark 设备 Key。 */
  barkDeviceKey: string;
  /** Bark 是否静音推送。 */
  barkSilentPush: boolean;
}

export const CATEGORY_LABELS: Record<BuiltInCategory, LocalizedLabels> = {
  productivity: labels('生产力', 'Productivity'),
  entertainment: labels('娱乐', 'Entertainment'),
  lifestyle: labels('生活', 'Lifestyle'),
  finance: labels('理财', 'Finance'),
  streaming: labels('影音流媒体', 'Streaming'),
  music: labels('音乐', 'Music'),
  gaming: labels('游戏', 'Gaming'),
  utilities: labels('公用事业', 'Utilities'),
  cloud_storage: labels('云存储', 'Cloud Storage'),
  education: labels('教育', 'Education'),
  health_fitness: labels('健康健身', 'Health & Fitness'),
  food_dining: labels('餐饮', 'Food & Dining'),
  shopping: labels('购物', 'Shopping'),
  travel: labels('旅行出行', 'Travel'),
  business: labels('商务', 'Business'),
  communication: labels('通讯与邮件', 'Communication & Email'),
  developer_tools: labels('开发工具', 'Developer Tools'),
  design: labels('设计创意', 'Design'),
  ai_tools: labels('AI 工具', 'AI Tools'),
  security_vpn: labels('安全与 VPN', 'Security & VPN'),
  hosting_domains: labels('域名与托管', 'Domains & Hosting'),
  news_media: labels('新闻媒体', 'News & Media'),
  other: labels('其他', 'Other'),
};

export const STATUS_LABELS: Record<SubscriptionStatus, LocalizedLabels> = {
  trial: labels('试用中', 'Trial'),
  active: labels('活跃', 'Active'),
  paused: labels('已暂停', 'Paused'),
  cancelled: labels('已取消', 'Cancelled'),
};

export const CYCLE_LABELS: Record<BillingCycle, LocalizedLabels> = {
  weekly: labels('每周', 'Weekly'),
  monthly: labels('每月', 'Monthly'),
  quarterly: labels('每季', 'Quarterly'),
  'semi-annual': labels('每半年', 'Semiannual'),
  annual: labels('每年', 'Annual'),
  custom: labels('自定义', 'Custom'),
};

export const CHANNEL_LABELS: Record<NotificationChannel, LocalizedLabels> = {
  telegram: labels('Telegram', 'Telegram'),
  notifyx: labels('Notifyx', 'Notifyx'),
  webhook: labels('Webhook 通知', 'Webhook'),
  wechat: labels('企业微信机器人', 'WeCom Bot'),
  email: labels('邮件通知', 'Email'),
  bark: labels('Bark', 'Bark'),
};

export const PAYMENT_METHOD_LABELS: Record<BuiltInPaymentMethod, LocalizedLabels> = {
  alipay: labels('支付宝', 'Alipay'),
  wechat: labels('微信支付', 'WeChat Pay'),
  credit_card: labels('信用卡', 'Credit card'),
  debit_card: labels('借记卡', 'Debit card'),
  paypal: labels('PayPal', 'PayPal'),
  apple_pay: labels('Apple Pay', 'Apple Pay'),
  google_pay: labels('Google Pay', 'Google Pay'),
  bank_transfer: labels('银行转账', 'Bank transfer'),
  crypto: labels('加密货币', 'Crypto'),
  other: labels('其他', 'Other'),
};

/** 货币选项所属地区（仅用于 UI 搜索关键词）。 */
export type CurrencyRegion = 'asia' | 'europe' | 'americas' | 'oceania' | 'africa' | 'global';

/** 货币下拉选项（用于新增/编辑订阅，以及自定义货币配置）。 */
export interface CurrencyOption {
  /** 货币代码（ISO 4217），例如：CNY、USD。 */
  value: string;
  /** UI 展示文案（可包含货币符号）。 */
  labels: LocalizedLabels;
  /** 地区分组（用于 UI 分组/排序展示）。 */
  region: CurrencyRegion;
}

/** 时区下拉选项（用于设置页选择）。 */
export interface TimezoneOption {
  /** IANA 时区名，例如：Asia/Shanghai。 */
  value: string;
  /** UI 展示文案（通常包含 UTC 偏移）。 */
  label: string;
}

/** 提醒天数下拉选项（用于新增/编辑订阅）。 */
export interface ReminderDaysOption {
  /** 提前多少天提醒（整数）。 */
  value: number;
  /** UI 展示文案。 */
  labels: LocalizedLabels;
}

export interface RepeatReminderIntervalOption {
  value: RepeatReminderInterval;
  labels: LocalizedLabels;
}

export interface RepeatReminderWindowOption {
  value: RepeatReminderWindow;
  labels: LocalizedLabels;
}

/** 两个远端汇率来源共同支持的 146 种货币（用于默认列表与下拉选项）。 */
export const CURRENCY_OPTIONS = SUPPORTED_EXCHANGE_RATE_CURRENCIES.map((value) => ({
  value,
  labels: labels(
    getIntlCurrencyOptionLabel(value, 'zh-CN'),
    getIntlCurrencyOptionLabel(value, 'en-US'),
  ),
  region: 'global',
})) satisfies readonly CurrencyOption[];

export const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Denver', label: 'America/Denver' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
  { value: 'Pacific/Kiritimati', label: 'Pacific/Kiritimati' },
] as const satisfies readonly TimezoneOption[];

export const REMINDER_DAYS_OPTIONS = [
  { value: 1, labels: labels('提前 1 天', '1 day before') },
  { value: 3, labels: labels('提前 3 天', '3 days before') },
  { value: 7, labels: labels('提前 7 天', '7 days before') },
  { value: 14, labels: labels('提前 14 天', '14 days before') },
  { value: 30, labels: labels('提前 30 天', '30 days before') },
] as const satisfies readonly ReminderDaysOption[];

export const REPEAT_REMINDER_INTERVAL_OPTIONS = [
  { value: '1h', labels: labels('每 1 小时', 'Every 1 hour') },
  { value: '3h', labels: labels('每 3 小时', 'Every 3 hours') },
  { value: '6h', labels: labels('每 6 小时', 'Every 6 hours') },
  { value: '12h', labels: labels('每 12 小时', 'Every 12 hours') },
  { value: '24h', labels: labels('每 24 小时', 'Every 24 hours') },
] as const satisfies readonly RepeatReminderIntervalOption[];

export const REPEAT_REMINDER_WINDOW_OPTIONS = [
  { value: '24h', labels: labels('到期前 24 小时内', 'Within 24 hours before renewal') },
  { value: '48h', labels: labels('到期前 48 小时内', 'Within 48 hours before renewal') },
  { value: '72h', labels: labels('到期前 72 小时内', 'Within 72 hours before renewal') },
  { value: 'full', labels: labels('从首次提醒后开始', 'After first reminder') },
] as const satisfies readonly RepeatReminderWindowOption[];

export const DEFAULT_SETTINGS: AppSettings = {
  adminUsername: 'admin',
  themeMode: 'dark',
  themeVariant: 'emerald',
  themeCustomColor: DEFAULT_CUSTOM_THEME_COLOR,
  locale: getInitialLocale(),
  showExpired: true,
  defaultCurrency: 'CNY',
  exchangeRateProvider: 'floatrates',
  monthlyBudget: 1500,
  timezone: 'UTC',
  notificationTimeLocal: '08:00' as LocalTime,
  enabledChannels: [],
  testPhone: '',
  telegramBotToken: '',
  telegramChatId: '',
  notifyxApiKey: '',
  webhookUrl: '',
  webhookMethod: 'POST',
  webhookHeaders: '',
  webhookPayload: '',
  wechatWebhookUrl: '',
  wechatMessageType: 'text',
  wechatAddModeTag: false,
  wechatAtPhones: '',
  wechatAtAll: false,
  smtpHost: '',
  smtpPort: '',
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  smtpReplyTo: '',
  notifyMultipleAddresses: false,
  recipientEmail: '',
  barkServerUrl: 'https://api.day.app',
  barkDeviceKey: '',
  barkSilentPush: false,
};
