import { describe, expect, it } from "vitest";
import { withAvailableRecipient } from "@/components/profiles/recipient-options";

const option = { id: "r1", label: "Sales", address: "s***@example.com" };
const config = (emailRecipientId: string | null) => ({
  notifications: { emailRecipientId, emailEnabled: true },
});

describe("profile editor recipient", () => {
  it("keeps a saved recipient that can still be chosen", () => {
    expect(withAvailableRecipient(config("r1"), [option])).toEqual({
      configuration: config("r1"),
      recipientUnavailable: false,
    });
  });

  it("starts from no recipient, and says so, when the saved one was archived or lost its opt-in", () => {
    const result = withAvailableRecipient(config("gone"), [option]);
    expect(result.recipientUnavailable).toBe(true);
    expect(result.configuration?.notifications).toEqual({ emailRecipientId: null, emailEnabled: true });
  });

  it("leaves profiles without a recipient, and new profiles, unchanged", () => {
    expect(withAvailableRecipient(config(null), []).recipientUnavailable).toBe(false);
    expect(withAvailableRecipient(undefined, [option])).toEqual({
      configuration: undefined,
      recipientUnavailable: false,
    });
  });
});
