import { describe, expect, it } from "vitest";
import { buildRenewalCalendarEvent, buildRenewalCalendarIcs } from "./ics";

describe("buildRenewalCalendarIcs", () => {
  it("maps renewal subscriptions into the shared calendar event shape", () => {
    const event = buildRenewalCalendarEvent({
      subscription: {
        id: "sub_1",
        name: "Fastmail",
        price: 5,
        currency: "USD",
        billingCycle: "monthly",
        category: "Productivity",
        paymentMethod: "Visa",
        nextBillingDate: "2026-06-02",
        website: "https://fastmail.example",
        notes: "Team plan",
      },
      labels: {
        amount: "$5.00",
        billingCycle: "Monthly",
        category: "Productivity",
        paymentMethod: "Visa",
      },
      reminderDays: 3,
      text: {
        amount: ({ amount }) => `Amount: ${amount}`,
        billingCycle: (cycle) => `Billing cycle: ${cycle}`,
        category: (category) => `Category: ${category}`,
        paymentMethod: (paymentMethod) => `Payment method: ${paymentMethod}`,
        notes: (notes) => `Notes: ${notes}`,
      },
    });

    expect(event).toEqual({
      uid: "renewlet-renewal-sub_1@renewlet",
      date: "2026-06-02",
      summary: "Fastmail",
      description: "Amount: $5.00\nBilling cycle: Monthly\nCategory: Productivity\nPayment method: Visa\nNotes: Team plan",
      categories: "Productivity",
      url: "https://fastmail.example",
      reminderDays: 3,
    });
  });

  it("renders date-only renewal events with escaped metadata and alarms", () => {
    const ics = buildRenewalCalendarIcs({
      name: "Renewlet Renewals",
      sourceUrl: "https://example.com/calendar/renewals.ics?token=abc",
      generatedAt: new Date("2026-05-29T10:20:30Z"),
      events: [
        {
          uid: "renewlet-renewal-sub_1@renewlet",
          date: "2026-06-02",
          summary: "Netflix, Family",
          description: "Amount: 15 USD\nNotes: Uses; plan",
          categories: "Entertainment",
          url: "https://netflix.example",
          reminderDays: 3,
        },
        {
          uid: "renewlet-renewal-sub_2@renewlet",
          date: "2026-06-01",
          summary: "Today reminder",
          description: "Amount: 9 USD",
          reminderDays: 0,
        },
      ],
    });

    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("NAME:Renewlet Renewals\r\n");
    const unfolded = ics.replaceAll("\r\n ", "");
    expect(unfolded).toContain("SOURCE;VALUE=URI:https://example.com/calendar/renewals.ics?token=abc\r\n");
    expect(ics).toContain("DTSTAMP:20260529T102030Z\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260601\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20260602\r\n");
    expect(unfolded).toContain("SUMMARY:Netflix\\, Family\r\n");
    expect(unfolded).toContain("DESCRIPTION:Amount: 15 USD\\nNotes: Uses\\; plan\r\n");
    expect(ics).toContain("CATEGORIES:Entertainment\r\n");
    expect(ics).toContain("URL;VALUE=URI:https://netflix.example\r\n");
    expect(ics).toContain("TRIGGER:PT0S\r\n");
    expect(ics).toContain("TRIGGER:-P3D\r\n");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("omits subscription refresh metadata for one-off downloads", () => {
    const ics = buildRenewalCalendarIcs({
      name: "Renewlet - Netflix",
      generatedAt: new Date("2026-05-29T10:20:30Z"),
      events: [
        {
          uid: "renewlet-renewal-sub_1@renewlet",
          date: "2026-06-02",
          summary: "Netflix",
          description: "Amount: 15 USD",
        },
      ],
    });

    expect(ics).toContain("NAME:Renewlet - Netflix\r\n");
    expect(ics).not.toContain("SOURCE;VALUE=URI");
    expect(ics).not.toContain("REFRESH-INTERVAL");
  });
});
