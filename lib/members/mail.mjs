import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemberError } from "./policy.mjs";
import { getMemberConfig, getMemberStore, privateBucket, reserveMemberEmail } from "./store.mjs";

export function requireMemberMail(config = getMemberConfig()) {
  if (config.mode === "disabled" || (config.mode === "resend" && (!config.resendKey || !config.from))) {
    throw new MemberError("EMAIL_UNAVAILABLE", "验证邮件服务暂未开通，请稍后再试。", 503);
  }
  return config;
}

const deliveryContext = new AsyncLocalStorage();

// Better Auth intentionally suppresses mail callback failures. Keep each request's
// result isolated and restore the failure at our browser-facing boundary.
export async function withMemberMail(run) {
  return deliveryContext.run({}, async () => {
    const result = await run();
    const error = deliveryContext.getStore()?.error;
    if (error) throw error;
    return result;
  });
}

export async function sendMemberOTP(message) {
  try { await deliverMemberOTP(message); }
  catch (error) {
    const context = deliveryContext.getStore();
    if (!context) throw error;
    context.error = error;
  }
}

async function deliverMemberOTP({ email, otp, type }) {
  const config = requireMemberMail();
  const db = getMemberStore();
  const id = randomUUID();
  const purpose = type === "sign-in" ? "registration" : type;
  reserveMemberEmail(db, { id, recipientHash: privateBucket(email), purpose });
  const subject = type === "forget-password" ? "烟斗派｜重置密码验证码" : type === "change-email" ? "烟斗派｜更换邮箱验证码" : "烟斗派｜邮箱验证码";
  const text = `你的烟斗派验证码为 ${otp}，10 分钟内有效。\n\n请勿向他人透露验证码。如非本人操作，请忽略此邮件。`;
  try {
    let providerId = "local-test";
    if (config.mode === "test") {
      mkdirSync(config.testMailDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(config.testMailDir, `${id}.json`), JSON.stringify({ email, otp, type, createdAt: Date.now() }), { mode: 0o600, flag: "wx" });
    } else {
      const result = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": id },
        body: JSON.stringify({ from: config.from, to: [email], subject, text }),
      });
      if (!result.ok) throw new MemberError("EMAIL_SEND_FAILED", "验证邮件暂时无法发送，请稍后再试。", 503);
      const body = await result.json();
      if (typeof body.id !== "string") throw new Error("Missing delivery reference");
      providerId = body.id;
    }
    db.prepare("UPDATE member_mail_deliveries SET state='sent',provider_id=? WHERE id=?").run(providerId, id);
  } catch (error) {
    db.prepare("UPDATE member_mail_deliveries SET state='failed' WHERE id=?").run(id);
    if (error instanceof MemberError) throw error;
    throw new MemberError("EMAIL_SEND_FAILED", "验证邮件暂时无法发送，请稍后再试。", 503);
  }
}
