import { z } from "zod";
import { parseJson, parseQuery, userRoute } from "@/lib/http/api";
import { q } from "@/lib/validation/common";
import { createRecipient, createRecipientSchema, listRecipients } from "@/modules/notifications/recipients";

const listQuery = z.object({ includeArchived: q.bool() });

/** Phone numbers are returned masked; the full number never leaves the server after creation. */
export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const { includeArchived } = parseQuery(req, listQuery);
  return listRecipients(db, actor, includeArchived ?? false);
});

export const POST = userRoute("OPERATOR", async ({ req, db, actor, requestId }) => {
  const input = await parseJson(req, createRecipientSchema);
  return createRecipient(db, actor, input, requestId);
});
