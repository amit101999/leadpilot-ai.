import { userRoute } from "@/lib/http/api";

export const GET = userRoute("VIEWER", async ({ user }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
}));
