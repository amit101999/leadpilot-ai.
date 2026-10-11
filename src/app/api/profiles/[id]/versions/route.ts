import { userRoute } from "@/lib/http/api";
import { uuidParam } from "@/lib/validation/common";
import { listVersions } from "@/modules/profiles/service";

export const GET = userRoute("VIEWER", async ({ db, actor, params }) =>
  listVersions(db, actor, uuidParam.parse(params.id)),
);
