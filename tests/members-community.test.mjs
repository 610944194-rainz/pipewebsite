import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemberStore } from "../lib/members/store.mjs";
import { initializeCommunity, adminActor, manageMember, moderateComment, saveFavorite } from "../lib/members/community-store.mjs";
import { initializeAdminSecurity } from "../lib/members/admin-security.mjs";

function fixture() {
  const db = openMemberStore(join(mkdtempSync(join(tmpdir(), "member-community-")), "test.sqlite"));
  initializeCommunity(db);
  initializeAdminSecurity(db);
  db.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT,emailVerified INTEGER,image TEXT,createdAt INTEGER,updatedAt INTEGER);
    CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,expiresAt INTEGER);
    CREATE TABLE account(id TEXT PRIMARY KEY,accountId TEXT,providerId TEXT,userId TEXT,password TEXT,createdAt INTEGER,updatedAt INTEGER);
    CREATE TABLE verification(id TEXT PRIMARY KEY,identifier TEXT);`);
  for (const [id,role] of [["owner","owner"],["admin","site_admin"],["moderator","moderator"],["user","member"]]) {
    db.prepare("INSERT INTO user VALUES(?,?,?,1,NULL,?,?)").run(id,id,`${id}@example.test`,Date.now(),Date.now());
    db.prepare("INSERT INTO member_profiles(user_id,role,created_at) VALUES(?,?,?)").run(id,role,new Date().toISOString());
    db.prepare("INSERT INTO session VALUES(?,?,?)").run(id,id,Date.now()+100000);
    db.prepare("INSERT INTO member_admin_grants VALUES(?,?,?,1)").run(id,id,Date.now()+100000);
    db.prepare("INSERT INTO member_admin_factors VALUES(?,'fixture',1,NULL,0,-1,'fixture')").run(id);
  }
  return db;
}
const actor = (id) => ({id,sessionId:id});
const change = (db,id,operation,value,more={}) => manageMember(db,actor(id),{targetId:"user",operation,value,reason:"synthetic test",...more});

test("community initialization preserves existing comments and is safe to repeat",()=>{
  const db=fixture(),now=new Date().toISOString();
  db.prepare("INSERT INTO member_comments(id,user_id,blend_id,content,content_hash,created_at,updated_at,blend_title) VALUES('history','user','blendv3:archived','history text','hash',?,?,'Archived blend')").run(now,now);
  initializeCommunity(db);
  assert.equal(db.prepare("SELECT content,blend_title FROM member_comments WHERE id='history'").get().blend_title,"Archived blend");
  assert.equal(db.prepare("SELECT count(*) AS n FROM member_comments").get().n,1);
  db.close();
});

test("staff grants are tied to current session, current role and unexpired authorization",()=>{
  const db=fixture();
  assert.throws(()=>adminActor(db,actor("user")),e=>e.status===403);
  assert.throws(()=>adminActor(db,{id:"admin",sessionId:"owner"}),e=>e.status===403);
  db.prepare("UPDATE member_admin_grants SET expires_at=0 WHERE user_id='admin'").run();
  assert.throws(()=>adminActor(db,actor("admin")),e=>e.code==="REAUTH_REQUIRED");
  db.close();
});
test("moderators cannot manage members; administrators cannot alter privileged accounts or roles",()=>{
  const db=fixture();
  assert.throws(()=>change(db,"moderator","status","banned"),e=>e.status===403);
  assert.throws(()=>change(db,"admin","role","site_admin"),e=>e.status===403);
  assert.throws(()=>manageMember(db,actor("admin"),{targetId:"moderator",operation:"delete",reason:"test"}),e=>e.status===403);
  assert.equal(db.prepare("SELECT status FROM member_profiles WHERE user_id='user'").get().status,"active");
  assert.equal(db.prepare("SELECT count(*) n FROM member_audit").get().n,0);
  db.close();
});
test("owner and current administrator cannot be deleted or demoted, and owner role cannot be assigned online",()=>{
  const db=fixture();
  for(const targetId of ["owner","admin"]){assert.throws(()=>manageMember(db,actor(targetId),{targetId,operation:"delete",reason:"test"}),e=>e.code==="PROTECTED_MEMBER");}
  assert.throws(()=>change(db,"owner","role","owner"),e=>e.status===403);
  change(db,"owner","role","moderator");
  assert.equal(db.prepare("SELECT role FROM member_profiles WHERE user_id='user'").get().role,"moderator");
  assert.equal(db.prepare("SELECT count(*) n FROM session WHERE userId='user'").get().n,0);
  db.close();
});
test("publication requires identity verification and ban atomically hides publication and deletes sessions",()=>{
  const db=fixture(),now=new Date().toISOString();
  db.prepare("INSERT INTO member_comments(id,user_id,blend_id,content,content_hash,created_at,updated_at) VALUES('comment','user','blendv3:test','safe text','hash',?,?)").run(now,now);
  assert.throws(()=>moderateComment(db,actor("moderator"),{id:"comment",status:"published",reason:"test"}),e=>e.code==="IDENTITY_REQUIRED");
  change(db,"admin","identity","verified",{channel:"offline review"});
  moderateComment(db,actor("moderator"),{id:"comment",status:"published",reason:"test"});
  change(db,"admin","status","banned");
  assert.equal(db.prepare("SELECT status FROM member_comments WHERE id='comment'").get().status,"hidden");
  assert.equal(db.prepare("SELECT count(*) n FROM session WHERE userId='user'").get().n,0);
  change(db,"admin","status","active");
  assert.equal(db.prepare("SELECT status FROM member_comments WHERE id='comment'").get().status,"hidden");
  db.close();
});
test("favorites are idempotent and remove only the current member's copy",()=>{
  const db=fixture(),item={productKey:"overseas:p1",productId:"p1",kind:"overseas",title:"retained snapshot"};
  saveFavorite(db,"user",item,true);saveFavorite(db,"user",item,true);saveFavorite(db,"admin",item,true);
  assert.equal(db.prepare("SELECT count(*) n FROM member_favorites").get().n,2);
  saveFavorite(db,"user",item,false);
  assert.equal(db.prepare("SELECT user_id FROM member_favorites").get().user_id,"admin");
  db.close();
});
test("member deletion anonymizes the user, clears content and credentials, and keeps an audit without credentials",()=>{
  const db=fixture(),now=new Date().toISOString();
  db.prepare("INSERT INTO account VALUES('a','user','credential','user','original-hash',?,?)").run(Date.now(),Date.now());
  db.prepare("INSERT INTO member_comments(id,user_id,blend_id,content,content_hash,created_at,updated_at) VALUES('c','user','blendv3:test','private text','h',?,?)").run(now,now);
  db.prepare("INSERT INTO verification VALUES('v','forget-password-otp-user@example.test')").run();
  change(db,"admin","delete");
  assert.equal(db.prepare("SELECT status FROM member_profiles WHERE user_id='user'").get().status,"deleted");
  assert.match(db.prepare("SELECT email FROM user WHERE id='user'").get().email,/@deleted.invalid$/);
  assert.equal(db.prepare("SELECT count(*) n FROM account WHERE userId='user'").get().n,0);
  assert.equal(db.prepare("SELECT content FROM member_comments WHERE id='c'").get().content,"");
  assert.equal(db.prepare("SELECT count(*) n FROM verification").get().n,0);
  assert.equal(db.prepare("SELECT details FROM member_audit WHERE action='member.delete'").get().details,"{}");
  db.close();
});
