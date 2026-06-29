import { expect, type Page } from "@playwright/test";

type ProductSessionRecord = {
  value?: {
    session?: { id?: string };
    user?: { id?: string };
  };
};

export type ProductSubscriptionSeed = {
  name: string;
  price: number;
  currency?: string;
  billingCycle?: "monthly" | "yearly";
  category?: string;
  status?: "active" | "trial" | "expired" | "paused" | "cancelled";
  paymentMethod?: string | null;
  startDate: string | null;
  nextBillingDate: string;
  autoRenew?: boolean;
  autoCalculateNextBillingDate?: boolean;
  reminderDays?: number;
  tags?: string[];
};

async function getProductAuthHeader(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("renewlet_app_session");
    if (!raw) {
      throw new Error("Missing Renewlet product session");
    }

    const record = JSON.parse(raw) as ProductSessionRecord;
    const token = record.value?.session?.id;
    const userId = record.value?.user?.id;
    if (!token || !userId) {
      throw new Error("Renewlet product session is missing token or user id");
    }

    return `Bearer ${token}`;
  });
}

export async function createProductSubscriptionSeed(page: Page, seed: ProductSubscriptionSeed) {
  const authorization = await getProductAuthHeader(page);
  const result = await page.evaluate(async ({ authorization: authHeader, seed: payload }) => {
    const response = await window.fetch("/api/app/subscriptions", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: payload.name,
        logo: null,
        price: payload.price,
        currency: payload.currency ?? "CNY",
        billingCycle: payload.billingCycle ?? "monthly",
        customDays: null,
        customCycleUnit: null,
        oneTimeTermCount: null,
        oneTimeTermUnit: null,
        category: payload.category ?? "productivity",
        status: payload.status ?? "active",
        paymentMethod: payload.paymentMethod ?? null,
        startDate: payload.startDate,
        nextBillingDate: payload.nextBillingDate,
        autoRenew: payload.autoRenew ?? false,
        autoCalculateNextBillingDate: payload.autoCalculateNextBillingDate ?? false,
        pinned: false,
        publicHidden: false,
        trialEndDate: null,
        website: null,
        notes: null,
        tags: payload.tags ?? [],
        reminderDays: payload.reminderDays ?? 3,
        repeatReminderEnabled: false,
        repeatReminderInterval: "1h",
        repeatReminderWindow: "72h",
        costSharing: null,
        extra: {},
      }),
    });

    return {
      body: await response.text(),
      ok: response.ok,
      status: response.status,
    };
  }, { authorization, seed });

  expect(result.ok, `create subscription seed ${seed.name}: ${result.status} ${result.body}`).toBe(true);
}
