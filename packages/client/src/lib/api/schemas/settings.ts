/**
 * 用户设置 API 的 Zod 契约。
 *
 * 架构位置：
 * - Settings 页提交的表单最终会通过该 schema 进入 `user_settings.settings` JSON 字段。
 * - 通知测试/手动运行也复用 partial schema，允许“未保存设置临时生效”。
 *
 * 注意： 这里的字段必须与 `DEFAULT_SETTINGS` 保持同步；新增设置时若只改 UI，会在保存时被丢弃。
 */
import { z } from "zod";
import { NOTIFICATION_CHANNELS, type AppSettings } from "@/types/subscription";
import { exchangeRateProviderSchema, normalizeExchangeRateProvider } from "@/lib/api/schemas/exchange-rates";
import { THEME_MODES, THEME_VARIANTS } from "@/types/theme";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { isValidLocalTime, type LocalTime } from "@/lib/time/local-time";
import { isValidTimeZone } from "@/lib/time/time-zone";

// 通知调度按“用户本地墙上时间”执行，因此保存 HH:mm 而不是 UTC instant。
const hhmmSchema = z.string().refine(isValidLocalTime, "时间格式必须为 HH:mm").transform((value) => value as LocalTime);

// 通知 Webhook 只允许 HTTPS，避免设置页成为明文凭据外泄入口。
const optionalHttpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "必须为空或 https:// URL");

const optionalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((value) => !value || z.email().safeParse(value).success, "邮箱格式无效");

const optionalSmtpPortSchema = z
  .string()
  .trim()
  .max(5)
  .refine((value) => {
    if (!value) return true;
    const port = Number.parseInt(value, 10);
    return Number.isInteger(port) && port > 0 && port <= 65_535 && String(port) === value;
  }, "SMTP 端口无效");

// 使用 IANA timezone 而不是固定 offset；DST/地区政策变化由 Intl 负责解释。
const timezoneSchema = z.string().trim().min(1).max(80).refine(isValidTimeZone, "时区无效");

/**
 * 用户设置（保存到 `public.user_settings.settings`）。
 *
 * 说明：
 * - 后端会将该对象作为 JSONB 直接存储，便于后续灵活扩展
 * - PUT 支持部分字段更新，服务端会与默认值合并
 */
export const appSettingsSchema = z
  .object({
    adminUsername: z.string().trim().min(1).max(80).describe("管理员用户名。"),

    themeMode: z.enum(THEME_MODES).describe("明暗模式（light/dark/system，对应本地 ThemeProvider）。"),
    themeVariant: z.enum(THEME_VARIANTS).describe("主题风格（对应 html[data-theme]）。"),
    themeCustomColor: z
      .object({
        h: z.number().min(0).max(360).describe("Hue：色相（0-360）。"),
        s: z.number().min(0).max(100).describe("Saturation：饱和度（0-100）。"),
        l: z.number().min(0).max(100).describe("Lightness：亮度（0-100）。"),
      })
      .describe("自定义主题色（HSL，仅 themeVariant=custom 时用于覆盖主色系）。"),
    locale: z.enum(SUPPORTED_LOCALES).describe("界面、错误和通知语言。"),

    showExpired: z.boolean().describe("通知中是否包含已过期订阅。"),
    defaultCurrency: z.string().trim().regex(/^[A-Z]{3}$/).describe("默认货币代码（用于统计/展示换算）。"),
    exchangeRateProvider: z.preprocess(
      normalizeExchangeRateProvider,
      exchangeRateProviderSchema,
    ).describe("首选汇率来源。"),

    monthlyBudget: z.number().finite().nonnegative().max(1_000_000_000).describe("月度预算（用于统计页预算占比）。"),

    timezone: timezoneSchema.describe("用户时区（如 Asia/Shanghai）。"),

    notificationTimeLocal: hhmmSchema.describe("通知时间（用户本地时间，格式 HH:mm）。"),
    enabledChannels: z
      .array(z.enum(NOTIFICATION_CHANNELS))
      .describe("启用的通知渠道列表。"),
    testPhone: z.string().trim().max(80).describe("第三方 API 测试号码。"),

    telegramBotToken: z.string().trim().max(256).describe("Telegram Bot Token。"),
    telegramChatId: z.string().trim().max(128).describe("Telegram Chat ID。"),

    notifyxApiKey: z.string().trim().max(256).describe("Notifyx API Key。"),

    webhookUrl: optionalHttpsUrlSchema.describe("Webhook URL。"),
    webhookMethod: z.enum(["GET", "POST"]).describe("Webhook 请求方法。"),
    webhookHeaders: z.string().max(20_000).describe("Webhook Headers（JSON 字符串）。"),
    webhookPayload: z.string().max(100_000).describe("Webhook Payload（模板/JSON 字符串）。"),

    wechatWebhookUrl: optionalHttpsUrlSchema.describe("企业微信机器人 Webhook URL。"),
    wechatMessageType: z.enum(["text", "markdown"]).describe("企业微信消息类型。"),
    wechatAddModeTag: z.boolean().describe("企业微信消息是否追加模式标签。"),
    wechatAtPhones: z.string().trim().max(1000).describe("企业微信 @ 手机号（逗号分隔）。"),
    wechatAtAll: z.boolean().describe("企业微信是否 @ 全体。"),

    smtpHost: z.string().trim().max(255).describe("SMTP 服务器地址。"),
    smtpPort: optionalSmtpPortSchema.describe("SMTP 端口。"),
    smtpSecure: z.boolean().describe("SMTP 是否使用 TLS 直连。"),
    smtpUser: z.string().trim().max(256).describe("SMTP 用户名。"),
    smtpPassword: z.string().trim().max(512).describe("SMTP 密码。"),
    smtpFrom: z.string().trim().max(320).describe("SMTP 发件人。"),
    smtpReplyTo: z.string().trim().max(320).describe("SMTP 回复地址。"),
    notifyMultipleAddresses: z.boolean().describe("是否支持多收件人。"),
    recipientEmail: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => {
        if (!value) return true;
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .every((item) => z.email().safeParse(item).success);
      }, "收件人邮箱格式无效")
      .describe("收件人邮箱。"),

    barkServerUrl: optionalHttpsUrlSchema.describe("Bark 服务器地址。"),
    barkDeviceKey: z.string().trim().max(256).describe("Bark 设备 Key。"),
    barkSilentPush: z.boolean().describe("Bark 是否静音推送。"),
  })
  .strict() satisfies z.ZodType<AppSettings>;

/** 设置读取响应结构。 */
export const settingsResponseSchema = z.object({
  settings: appSettingsSchema.describe("用户设置对象。"),
}).strict();

/** 设置更新请求体：支持部分字段更新。 */
export const settingsUpdateBodySchema = appSettingsSchema.partial().describe("支持部分字段更新。");
