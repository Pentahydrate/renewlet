import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarFeedService } from "@/services/calendar-feed-service";

const CALENDAR_FEED_QUERY_KEY = ["calendar-feed"] as const;
const subscriptionCalendarFeedQueryKey = (subscriptionId: string) => ["subscription-calendar-feed", subscriptionId] as const;

export function useCalendarFeedStatus() {
  return useQuery({
    queryKey: CALENDAR_FEED_QUERY_KEY,
    queryFn: () => calendarFeedService.get(),
  });
}

export function useCreateCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => calendarFeedService.create(),
    onSuccess: (calendarFeed) => {
      queryClient.setQueryData(CALENDAR_FEED_QUERY_KEY, calendarFeed);
    },
  });
}

export function useDeleteCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => calendarFeedService.delete(),
    onSuccess: () => {
      queryClient.setQueryData(CALENDAR_FEED_QUERY_KEY, { enabled: false });
    },
  });
}

export function useCreateSubscriptionCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId: string) => calendarFeedService.createSubscription(subscriptionId),
    onSuccess: (calendarFeed, subscriptionId) => {
      queryClient.setQueryData(subscriptionCalendarFeedQueryKey(subscriptionId), calendarFeed);
    },
  });
}

export function useSubscriptionCalendarFeedStatus(subscriptionId: string, enabled: boolean) {
  return useQuery({
    queryKey: subscriptionCalendarFeedQueryKey(subscriptionId),
    queryFn: () => calendarFeedService.getSubscription(subscriptionId),
    enabled,
  });
}

export function useDeleteSubscriptionCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId: string) => calendarFeedService.deleteSubscription(subscriptionId),
    onSuccess: (_, subscriptionId) => {
      queryClient.setQueryData(subscriptionCalendarFeedQueryKey(subscriptionId), { enabled: false });
    },
  });
}
