import "server-only";
import { getMemberSession } from "./auth";
import { getMemberStore } from "./store.mjs";
import { adminActor } from "./community-store.mjs";
import { MemberError } from "./policy.mjs";

export async function requireAdmin(headers: Headers, grant = false) {
  const member = await getMemberSession(headers);
  if (!member) throw new MemberError("UNAUTHORIZED", "请先登录。", 401);
  const actor = { id: member.user.id, sessionId: member.session.id };
  const profile = adminActor(getMemberStore(), actor, grant);
  return { member, actor, role: String(profile.role) };
}
