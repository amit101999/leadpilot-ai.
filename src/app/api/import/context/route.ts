import { z } from "zod";
import { parseQuery, tokenRoute } from "@/lib/http/api";
import { q } from "@/lib/validation/common";
import { getImportContext } from "@/modules/imports/service";

const query = z.object({ scheduled: q.bool() });

/** GET /api/import/context?scheduled=true|false — profiles to sync, their keywords, filters and due state. */
export const GET = tokenRoute("OPERATOR", async ({ req, db, actor }) => {
  const { scheduled } = parseQuery(req, query);
  return getImportContext(db, actor, { scheduled: scheduled ?? false });
});
