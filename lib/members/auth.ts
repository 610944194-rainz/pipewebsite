import "server-only";
import { createHmac } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { getMemberConfig, getMemberStore, getMemberProfile } from "./store.mjs";
import { sendMemberOTP } from "./mail.mjs";
import { validateNickname } from "./policy.mjs";

function createMemberOptions() {
  const config = getMemberConfig();
  const db = getMemberStore();
  return {
    appName: "烟斗派", secret: config.secret, baseURL: config.origin,
    database: db, trustedOrigins: [config.origin], telemetry: { enabled: false },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 6, maxPasswordLength: 128, requireEmailVerification: true, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, freshAge: 60 * 60, cookieCache: { enabled: false } },
    advanced: { cookiePrefix: "yandou-members", useSecureCookies: config.origin.startsWith("https://"), database: { generateId: "uuid" }, ipAddress: { disableIpTracking: process.env.MEMBERS_TRUST_PROXY !== "true", ipAddressHeaders: ["x-real-ip"] } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/update-user") {
        const body = ctx.body as Record<string, unknown>;
        if (Object.keys(body).some((key) => key !== "name")) throw new APIError("BAD_REQUEST", { message: "只能修改昵称。" });
        try { body.name = validateNickname(body.name); } catch { throw new APIError("BAD_REQUEST", { message: "昵称不符合要求。" }); }
      }
    }) },
    databaseHooks: {
      user: { create: { after: async (user) => {
        db.prepare("INSERT OR IGNORE INTO member_profiles(user_id,created_at) VALUES(?,?)").run(user.id, new Date().toISOString());
      } } },
      session: { create: { before: async (session) => {
        const profile = getMemberProfile(session.userId);
        if (!profile || profile.status !== "active") throw new APIError("FORBIDDEN", { message: "账号暂不可用。" });
        return { data: session };
      } } },
    },
    plugins: [emailOTP({
      otpLength: 6, expiresIn: 600, allowedAttempts: 5, resendStrategy: "rotate",
      storeOTP: { hash: async (otp) => createHmac("sha256", config.secret).update(`member-otp:${otp}`).digest("hex") },
      changeEmail: { enabled: true, verifyCurrentEmail: true },
      sendVerificationOTP: sendMemberOTP,
    })],
  } satisfies BetterAuthOptions;
}

function createMemberAuth() { return betterAuth(createMemberOptions()); }

let initialization: Promise<ReturnType<typeof createMemberAuth>> | undefined;
export function getMemberAuth() {
  if (!initialization) initialization = (async () => {
    const migrations = await getMigrations(createMemberOptions());
    await migrations.runMigrations();
    return createMemberAuth();
  })().catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

export async function getMemberSession(headers: Headers) {
  const auth = await getMemberAuth();
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const profile = getMemberProfile(session.user.id);
  if (!profile || profile.status !== "active" || !session.user.emailVerified) {
    getMemberStore().prepare('DELETE FROM session WHERE "userId"=?').run(session.user.id);
    return null;
  }
  return { ...session, profile };
}
