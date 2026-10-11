import { describe, expect, it } from "vitest";
import { parseStatusWebhook } from "@/modules/notifications/webhook";

function payload(statuses: unknown[], field = "messages") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", statuses } }] }],
  };
}

describe("parseStatusWebhook", () => {
  it("maps sent, delivered, read and failed to notification statuses", () => {
    const events = parseStatusWebhook(
      payload([
        { id: "wamid.1", status: "sent", timestamp: "1750030073", recipient_id: "16505551234" },
        { id: "wamid.1", status: "delivered", timestamp: "1750030080" },
        { id: "wamid.1", status: "read", timestamp: "1750030090" },
        { id: "wamid.2", status: "failed", errors: [{ code: 131049, title: "Not delivered" }] },
      ]),
    );
    expect(events.map((e) => e.status)).toEqual(["SENT", "DELIVERED", "READ", "FAILED_PERMANENT"]);
    expect(events[0]!.at.toISOString()).toBe(new Date(1750030073 * 1000).toISOString());
    expect(events[3]!.error).toContain("131049");
  });

  it("keeps biz_opaque_callback_data so uncertain sends can be matched", () => {
    const [event] = parseStatusWebhook(
      payload([{ id: "wamid.9", status: "sent", biz_opaque_callback_data: "abc123" }]),
    );
    expect(event!.callbackData).toBe("abc123");
  });

  it("never exposes the recipient phone number", () => {
    const events = parseStatusWebhook(
      payload([{ id: "wamid.1", status: "sent", recipient_id: "16505551234" }]),
    );
    expect(JSON.stringify(events)).not.toContain("16505551234");
  });

  it("skips unknown statuses, malformed items and non-message fields without throwing", () => {
    expect(parseStatusWebhook(payload([{ id: "wamid.1", status: "deleted" }]))).toEqual([]);
    expect(parseStatusWebhook(payload([{ status: "sent" }, "garbage", null]))).toEqual([]);
    expect(parseStatusWebhook(payload([{ id: "wamid.1", status: "sent" }], "account_update"))).toEqual([]);
  });

  it("returns nothing for payloads that are not WhatsApp Business account events", () => {
    expect(parseStatusWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseStatusWebhook(null)).toEqual([]);
    expect(parseStatusWebhook("string")).toEqual([]);
  });
});
