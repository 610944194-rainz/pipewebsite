const PUSHDEER_API_URL = "https://api2.pushdeer.com/message/push";

export function resolvePushDeerPushKey(env = process.env) {
  const candidates = [
    "PUSHDEER_KEY",
    "PUSHDEER_PUSHKEY",
    "YAN_DOUBUY_PUSHDEER_PUSHKEY",
  ];

  for (const envName of candidates) {
    const key = String(env?.[envName] || "").trim();

    if (key) {
      return { key, envName };
    }
  }

  return { key: "", envName: "" };
}

export async function sendPushDeerNotification({
  title,
  body,
  dryRun = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const messageTitle = String(title || "").trim();
  const messageBody = String(body || "").trim();
  const { key, envName } = resolvePushDeerPushKey(env);

  if (!key) {
    return {
      notificationSent: false,
      notificationSkipped: true,
      notificationReason: "missing PushDeer key",
      pushDeerEnvName: "",
      channel: "PushDeer",
      dryRun: Boolean(dryRun),
    };
  }

  if (dryRun) {
    return {
      notificationSent: false,
      notificationSkipped: true,
      notificationReason: "dry-run notification",
      pushDeerEnvName: envName,
      channel: "PushDeer",
      dryRun: true,
      title: messageTitle,
      body: messageBody,
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      notificationSent: false,
      notificationSkipped: false,
      notificationReason: "fetch is unavailable",
      pushDeerEnvName: envName,
      channel: "PushDeer",
      dryRun: false,
    };
  }

  const url = new URL(PUSHDEER_API_URL);
  url.searchParams.set("pushkey", key);
  url.searchParams.set("text", messageTitle);
  url.searchParams.set("desp", messageBody);

  try {
    const response = await fetchImpl(url);

    return {
      notificationSent: Boolean(response?.ok),
      notificationSkipped: false,
      notificationReason: response?.ok
        ? "sent"
        : `PushDeer HTTP ${response?.status || "unknown"}`,
      pushDeerEnvName: envName,
      channel: "PushDeer",
      dryRun: false,
      status: response?.status || null,
    };
  } catch (error) {
    return {
      notificationSent: false,
      notificationSkipped: false,
      notificationReason: error?.message || String(error),
      pushDeerEnvName: envName,
      channel: "PushDeer",
      dryRun: false,
    };
  }
}
