import { z } from "zod";
import { parseJson, parseQuery, userRoute } from "@/lib/http/api";
import { q } from "@/lib/validation/common";
import { createProfileSchema } from "@/modules/profiles/schema";
import { createProfile, listProfiles } from "@/modules/profiles/service";

const listQuery = z.object({ includeArchived: q.bool() });

export const GET = userRoute("VIEWER", async ({ req, db, actor }) => {
  const { includeArchived } = parseQuery(req, listQuery);
  return listProfiles(db, actor, { includeArchived: includeArchived ?? false });
});

export const POST = userRoute("OPERATOR", async ({ req, db, actor, requestId }) => {
  const input = await parseJson(req, createProfileSchema);
  return createProfile(db, actor, input, requestId);
});
