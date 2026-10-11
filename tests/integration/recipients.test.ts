import { describe, expect, it } from "vitest";
import { GET as listRecipients, POST as createRecipient } from "@/app/api/recipients/route";
import { PATCH as patchRecipient } from "@/app/api/recipients/[id]/route";
import { call, createUser } from "./helpers";

const PHONE = "+14155550123";

describe("recipients API", () => {
  it("never returns the full phone number", async () => {
    const user = await createUser("OPERATOR");
    const created = await call(createRecipient, {
      method: "POST",
      user,
      body: { label: "Me", phoneE164: PHONE, optInConfirmed: false },
    });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.json)).not.toContain(PHONE);

    const list = await call(listRecipients, { user });
    expect(list.json.data).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(PHONE);
  });

  it("rejects numbers that are not E.164", async () => {
    const user = await createUser("OPERATOR");
    const res = await call(createRecipient, {
      method: "POST",
      user,
      body: { label: "Bad", phoneE164: "4155550123", optInConfirmed: true },
    });
    expect(res.status).toBe(400);
  });

  it("confirms opt-in, and another user cannot modify the recipient", async () => {
    const owner = await createUser("OPERATOR");
    const other = await createUser("OPERATOR");
    const created = await call(createRecipient, {
      method: "POST",
      user: owner,
      body: { label: "Owner phone", phoneE164: PHONE, optInConfirmed: false },
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
