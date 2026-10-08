export class MemberError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function normalizeEmail(value) {
  if (typeof value !== "string") throw new MemberError("INVALID_EMAIL", "请输入有效邮箱。");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MemberError("INVALID_EMAIL", "请输入有效邮箱。");
  }
  return email;
}

export function validateNickname(value) {
  if (typeof value !== "string") throw new MemberError("INVALID_NAME", "昵称需为 2～24 个字符。");
  const name = value.trim();
  if ([...name].length < 2 || [...name].length > 24 || /[<>\p{C}]/u.test(name) || /管理员|官方|客服|https?:|www\./i.test(name)) {
    throw new MemberError("INVALID_NAME", "昵称需为 2～24 个字符，请勿使用官方身份或链接。");
  }
  return name;
}

export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 6 || value.length > 128) {
    throw new MemberError("INVALID_PASSWORD_LENGTH", "密码需为 6～128 个字符。");
  }
  return value;
}

export function safeReturnTo(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s\p{C}]/u.test(value)) return "/account";
  try {
    const url = new URL(value, "https://members.invalid");
    if (url.origin !== "https://members.invalid" || /^\/(?:api|login|register|forgot-password)(?:\/|$)/.test(url.pathname)) return "/account";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/account";
  }
}
