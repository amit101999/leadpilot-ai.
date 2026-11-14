import type { Metadata } from "next";
import { z } from "zod";
import { NotificationsTable } from "@/components/notifications/notifications-table";
import { Panel } from "@/components/ui/panel";
import { hasRole } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/database/client";
import { notificationStatus } from "@/lib/database/schema";
import { paginationQuery, q, resolvePagination } from "@/lib/validation/common";
import { parseSearchParams, type RawSearchParams } from "@/lib/validation/search-params";
import { listNotifications } from "@/modules/notifications/service";

export const metadata: Metadata = { title: "Notifications" };

const query = z.object({
  ...paginationQuery,
  status: q.enumList(notificationStatus.enumValues),
  search: q.string(200),
});

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { actor } = await requireUser();
  const filters = parseSearchParams(query, await searchParams);
  const page = resolvePagination(filters);
  const { items, total } = await listNotifications(getDb(), actor, { ...filters, ...page });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] leading-tight font-semibold">Notifications</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Every e-mail alert and what happened to it. Sent means the mail server accepted the e-mail; it is
          not proof that it reached the inbox.
        </p>
      </header>
      <Panel id="notifications">
        <NotificationsTable
          rows={items}
          meta={{
            page: page.page,
            pageSize: page.pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
          }}
          canOperate={hasRole(actor, "OPERATOR")}
        />
      </Panel>
    </div>
  );
}
