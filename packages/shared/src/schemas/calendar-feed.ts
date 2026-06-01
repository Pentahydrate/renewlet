import { z } from "zod";

export const calendarFeedStatusSchema = z.object({
  enabled: z.boolean(),
  createdAt: z.string().optional(),
  feedUrl: z.string().trim().url().max(4096).optional(),
  updatedAt: z.string().optional(),
}).strict();

export const calendarFeedStatusResponseSchema = z.object({
  calendarFeed: calendarFeedStatusSchema,
}).strict();

export const calendarFeedCreateRequestSchema = z.object({}).strict();

export const calendarFeedCreateResponseSchema = z.object({
  calendarFeed: z.object({
    enabled: z.literal(true),
    createdAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
    feedUrl: z.string().trim().url().max(4096),
  }).strict(),
}).strict();

export const subscriptionCalendarFeedCreateResponseSchema = calendarFeedCreateResponseSchema;

export const calendarFeedDeleteResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export type CalendarFeedStatus = z.infer<typeof calendarFeedStatusSchema>;
export type CalendarFeedStatusResponse = z.infer<typeof calendarFeedStatusResponseSchema>;
export type CalendarFeedCreateRequest = z.infer<typeof calendarFeedCreateRequestSchema>;
export type CalendarFeedCreateResponse = z.infer<typeof calendarFeedCreateResponseSchema>;
export type SubscriptionCalendarFeedCreateResponse = z.infer<typeof subscriptionCalendarFeedCreateResponseSchema>;
