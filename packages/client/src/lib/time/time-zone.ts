/**
 * IANA 时区工具。
 *
 * 注意：
 * - 不保存固定 UTC offset，因为 DST 和地区政策会变化。
 * - 展示 offset 只作为“当前时刻”的辅助信息，不能作为调度语义。
 */

/** 使用 Intl 校验 IANA timezone 是否可被当前运行时识别。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** 断言时区有效；非法值会抛错，避免调度落入隐式 UTC。 */
export function assertTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid time zone: ${timeZone}`);
  }
  return timeZone;
}

/** 读取浏览器/运行时系统时区，不可用时回退 UTC。 */
export function getSystemTimeZone(fallback = "UTC"): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 返回当前运行时支持的时区列表。
 *
 * 注意： 某些 Node/浏览器环境缺少 `Intl.supportedValuesOf`，需保留常用列表兜底。
 */
export function getSupportedTimeZones(): string[] {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  }).supportedValuesOf?.bind(Intl);
  if (supportedValuesOf) {
    try {
      const values = supportedValuesOf("timeZone");
      return values.includes("UTC") ? values : ["UTC", ...values];
    } catch {
      // 旧运行时可能没有完整 ICU 数据，下面用常用列表兜底。
    }
  }

  return [
    "UTC",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Sao_Paulo",
    "Pacific/Honolulu",
    "Pacific/Auckland",
    "Pacific/Kiritimati",
  ];
}

/** 格式化某时区在当前时刻的 UTC offset；仅用于展示，不用于持久化。 */
export function formatTimeZoneOffset(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    return parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** 格式化下拉展示文案，包含 IANA 名称和当前 offset。 */
export function formatTimeZoneOption(timeZone: string, now = new Date()): string {
  return `${timeZone} (${formatTimeZoneOffset(timeZone, now)})`;
}
