import { describe, expect, it } from "vitest";
import { GET as listRecipients, POST as createRecipient } from "@/app/api/recipients/route";
import { PATCH as patchRecipient } from "@/app/api/recipients/[id]/route";
import { call, createUser } from "./helpers";

const ADDRESS = "jane.doe@example.com";

describe("recipients API", () => {
  it("never returns the full e-mail address", async () => {
    const user = await createUser("OPERATOR");
    const created = await call(createRecipient, {
      method: "POST",
      user,
      body: { label: "Me", email: ADDRESS, optInConfirmed: false },
    });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.json)).not.toContain(ADDRESS);
    expect(created.json.data.emailMasked).toBe("j•••@example.com");

    const list = await call(listRecipients, { user });
    expect(list.json.data).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(ADDRESS);
  });

  it("rejects invalid e-mail addresses and phone numbers", async () => {
    const user = await createUser("OPERATOR");
    for (const body of [
      { label: "Bad", email: "not-an-address", optInConfirmed: true },
      { label: "Phone", phoneE164: "+14155550123", optInConfirmed: true },
    ]) {
      expect((await call(createRecipient, { method: "POST", user, body })).status).toBe(400);
    }
  });

  it("confirms opt-in, and another user cannot modify the recipient", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const created = await call(createRecipient, {
      method: "POST",
      user: owner,
      body: { label: "Owner address", email: ADDRESS, optInConfirmed: false },
    });
    const id = created.json.data.id as string;

    const foreign = await call(patchRecipient, {
      method: "PATCH",
      user: other,
      params: { id },
      body: { optInConfirmed: true },
    });
    expect(foreign.status).toBe(404);

    const confirmed = await call(patchRecipient, {
      method: "PATCH",
      user: owner,
      params: { id },
      body: { optInConfirmed: true },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.optInConfirmedAt).not.toBeNull();
  });
});
