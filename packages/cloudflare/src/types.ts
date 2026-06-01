import type { AdminUser } from "@renewlet/shared/schemas/admin";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { ApiSubscription } from "@renewlet/shared/schemas/subscriptions";

export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  SETUP_ENABLED?: string;
  SESSION_TTL_DAYS?: string;
  RENEWLET_VERSION?: string;
  RENEWLET_COMMIT?: string;
  RENEWLET_BUILD_TIME?: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  banned: number;
  ban_reason: string;
  password_hash: string;
  reset_token_hash: string | null;
  reset_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

export interface SessionAuthRow extends UserRow {
  session_id: string;
  session_token_hash: string;
  session_user_id: string;
  session_expires_at: string;
  session_created_at: string;
  session_last_seen_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  name: string;
  logo: string | null;
  price: number;
  currency: string;
  billing_cycle: string;
  custom_days: number | null;
  category: string;
  status: string;
  payment_method: string | null;
  start_date: string;
  next_billing_date: string;
  auto_calculate_next_billing_date: number;
  trial_end_date: string | null;
  website: string | null;
  notes: string | null;
  tags_json: string;
  reminder_days: number;
  repeat_reminder_enabled: number;
  repeat_reminder_interval: string;
  repeat_reminder_window: string;
  extra_json: string;
  created_at: string;
  updated_at: string;
}

export interface AssetRow {
  id: string;
  user_id: string;
  kind: "logo" | "icon";
  r2_key: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationJobRow {
  id: string;
  user_id: string;
  scheduled_local_date: string;
  scheduled_local_time: string;
  time_zone: string;
  scheduled_instant_utc: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  last_error: string | null;
  result_json: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarFeedRow {
  id: string;
  user_id: string;
  scope: "all" | "subscription";
  subscription_id: string | null;
  token: string;
  created_at: string;
  updated_at: string;
}

export interface AuthContext {
  token: string;
  session: SessionRow;
  user: UserRow;
}

export type { AdminUser, ApiAppSettings, ApiSubscription };
