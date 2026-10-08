import { getMemberStore } from "../lib/members/store.mjs";
import { normalizeEmail } from "../lib/members/policy.mjs";
import { transaction, audit } from "../lib/members/community-store.mjs";

// Run only from the server's private environment; there is no HTTP bootstrap path.
const flag = process.argv.indexOf("--email");
if (flag < 0 || !process.argv[flag + 1]) throw new Error("Supply the verified owner email with --email");
const email = normalizeEmail(process.argv[flag + 1]), db = getMemberStore();
try {
  transaction(db, () => {
    const user = db.prepare('SELECT id,"emailVerified" FROM user WHERE email=?').get(email);
    if (!user || !user.emailVerified) throw new Error("Owner must already be registered and email verified");
    const profile = db.prepare("SELECT status,role FROM member_profiles WHERE user_id=?").get(user.id);
    if (profile?.status !== "active") throw new Error("Owner account must be active");
    const owner = db.prepare("SELECT user_id FROM member_profiles WHERE role='owner'").get();
    if (owner) { if (owner.user_id === user.id) return; throw new Error("An owner is already configured; use a reviewed recovery procedure"); }
    db.prepare("UPDATE member_profiles SET role='owner' WHERE user_id=?").run(user.id);
    db.prepare('DELETE FROM session WHERE "userId"=?').run(user.id);
    audit(db, "bootstrap", "owner.bootstrap", user.id, "Private local bootstrap");
  });
  console.log("Owner configured. Sign in again to access member administration.");
} finally { db.close(); }
