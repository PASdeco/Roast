import "server-only";

import { getSessionUser, type LedgerUser } from "@/server/ledger";

function sessionTokenFromRequest(request: Request): string | null {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("roast_session="));
  if (!cookie) return null;
  const token = cookie.slice("roast_session=".length);
  return token || null;
}

export async function sessionUserFromRequest(request: Request): Promise<LedgerUser | undefined> {
  const token = sessionTokenFromRequest(request);
  if (!token) return undefined;
  return getSessionUser(token);
}
