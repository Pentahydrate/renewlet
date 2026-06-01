import { apiFetch } from "@/lib/api-client";
import {
  calendarFeedCreateResponseSchema,
  calendarFeedDeleteResponseSchema,
  calendarFeedStatusResponseSchema,
  subscriptionCalendarFeedCreateResponseSchema,
  type CalendarFeedCreateResponse,
  type CalendarFeedStatusResponse,
  type SubscriptionCalendarFeedCreateResponse,
} from "@/lib/api/schemas/calendar-feed";

export const calendarFeedService = {
  async get(): Promise<CalendarFeedStatusResponse["calendarFeed"]> {
    const data = await apiFetch("/api/app/calendar-feed", calendarFeedStatusResponseSchema);
    return data.calendarFeed;
  },

  async create(): Promise<CalendarFeedCreateResponse["calendarFeed"]> {
    const data = await apiFetch("/api/app/calendar-feed", calendarFeedCreateResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return data.calendarFeed;
  },

  async delete(): Promise<void> {
    await apiFetch("/api/app/calendar-feed", calendarFeedDeleteResponseSchema, { method: "DELETE" });
  },

  async getSubscription(subscriptionId: string): Promise<CalendarFeedStatusResponse["calendarFeed"]> {
    const data = await apiFetch(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar-feed`, calendarFeedStatusResponseSchema);
    return data.calendarFeed;
  },

  async createSubscription(subscriptionId: string): Promise<SubscriptionCalendarFeedCreateResponse["calendarFeed"]> {
    const data = await apiFetch(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar-feed`, subscriptionCalendarFeedCreateResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return data.calendarFeed;
  },

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await apiFetch(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar-feed`, calendarFeedDeleteResponseSchema, { method: "DELETE" });
  },
};
