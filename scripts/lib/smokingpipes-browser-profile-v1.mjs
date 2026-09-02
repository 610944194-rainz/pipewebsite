import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const SP_CHROME_PROFILE_NAME = "sp-chrome";
export const SP_CHROME_V2_PROFILE_NAME = "sp-chrome-v2";
export const SMOKINGPIPES_LINUX_RUNTIME_DIR = "/srv/yandoubuy/runtime/smokingpipes";

function normalizedChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  return channel === "chromium" ? "chromium" : channel || null;
}

function normalizedPathForComparison(value) {
  return path.resolve(String(value || "")).replaceAll("/", "\\").toLowerCase();
}

function defaultLocalAppData(platform, localAppData) {
  if (localAppData) return localAppData;
  if (platform === "win32") {
    return (
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local")
    );
  }
  return path.join(os.homedir(), ".local", "share");
}

function linuxSmokingpipesRuntimeDir(value) {
  return path.resolve(
    value ||
      process.env.SMOKINGPIPES_RUNTIME_DIR ||
      SMOKINGPIPES_LINUX_RUNTIME_DIR
  );
}

export function assertSafeSmokingpipesProfileDir({
  profileDir,
  localAppData,
  platform = process.platform,
}) {
  if (platform !== "win32") return;
  const chromeUserData = normalizedPathForComparison(
    path.join(
      defaultLocalAppData(platform, localAppData),
      "Google",
      "Chrome",
      "User Data"
    )
  );
  const candidate = normalizedPathForComparison(profileDir);
  if (
    candidate === chromeUserData ||
    candidate.startsWith(`${chromeUserData}\\`)
  ) {
    throw new Error(
      "The daily Chrome profile is not allowed. Use the dedicated YandouBuy sp-chrome profile."
    );
  }
}

export function resolveSmokingpipesBrowserProfile({
  root = process.cwd(),
  browserChannel = null,
  browserProfile = null,
  browserProfileDir = null,
  localAppData = process.env.LOCALAPPDATA || "",
  environmentUserDataDir =
    process.env.SMOKINGPIPES_USER_DATA_DIR || "",
  platform = process.platform,
  smokingpipesRuntimeDir =
    process.env.SMOKINGPIPES_RUNTIME_DIR || "",
} = {}) {
  const requestedBrowserChannel = normalizedChannel(browserChannel);
  const requestedBrowserProfile = browserProfile
    ? String(browserProfile).trim().toLowerCase()
    : null;
  const requestedBrowserProfileDir = browserProfileDir
    ? path.resolve(String(browserProfileDir))
    : null;
  if (
    requestedBrowserProfile &&
    ![SP_CHROME_PROFILE_NAME, SP_CHROME_V2_PROFILE_NAME].includes(requestedBrowserProfile)
  ) {
    throw new Error(
      `Unsupported browser profile ${requestedBrowserProfile}. Supported: ${SP_CHROME_PROFILE_NAME}, ${SP_CHROME_V2_PROFILE_NAME}.`
    );
  }

  const effectiveBrowserChannel =
    [SP_CHROME_PROFILE_NAME, SP_CHROME_V2_PROFILE_NAME].includes(requestedBrowserProfile)
      ? "chrome"
      : requestedBrowserChannel;
  let profileDir;
  let profileSource;

  if (requestedBrowserProfileDir) {
    profileDir = requestedBrowserProfileDir;
    profileSource = "explicit-dir";
  // ===== BEGIN PROTECTED OPTIMIZATION: Smokingpipes V2 dedicated Chrome profile =====
  // Smokingpipes V2 must remain on its clean persistent profile unless the user
  // explicitly authorizes a profile migration or a return to the legacy profile.
  } else if (requestedBrowserProfile === SP_CHROME_V2_PROFILE_NAME) {
    if (platform === "linux") {
      profileDir = path.join(
        linuxSmokingpipesRuntimeDir(smokingpipesRuntimeDir),
        "chrome-profile"
      );
      profileSource = "linux-runtime-sp-chrome-v2";
    } else {
      profileDir = path.join(
        defaultLocalAppData(platform, localAppData),
        "YandouBuy",
        "chrome-profile-sp-v2"
      );
      profileSource = "named-sp-chrome-v2";
    }
  } else if (requestedBrowserProfile === SP_CHROME_PROFILE_NAME) {
    profileDir = path.join(
      defaultLocalAppData(platform, localAppData),
      "YandouBuy",
      "chrome-profile-sp"
    );
    profileSource = "named-sp-chrome";
  // ===== END PROTECTED OPTIMIZATION =====
  } else if (effectiveBrowserChannel === "chrome") {
    profileDir = path.join(
      defaultLocalAppData(platform, localAppData),
      "YandouBuy",
      "chrome-profile-sp"
    );
    profileSource = "default-chrome-sp";
  } else if (environmentUserDataDir) {
    profileDir = path.resolve(environmentUserDataDir);
    profileSource = "legacy-environment";
  } else {
    profileDir = path.join(
      root,
      ".cache",
      "smokingpipes-profile"
    );
    profileSource = "legacy-project-cache";
  }

  assertSafeSmokingpipesProfileDir({
    profileDir,
    localAppData,
    platform,
  });

  return {
    requestedBrowserChannel,
    effectiveBrowserChannel,
    requestedBrowserProfile,
    requestedBrowserProfileDir,
    profileDir: path.resolve(profileDir),
    profileSource,
    profileLockRequired: effectiveBrowserChannel === "chrome",
  };
}

export function buildSmokingpipesBrowserDescriptor(options = {}) {
  const profile = resolveSmokingpipesBrowserProfile(options);
  const requestedHeadless =
    String(
      options.headless ??
        process.env.SMOKINGPIPES_HEADLESS ??
        "false"
    ).toLowerCase() === "true";
  return {
    ...profile,
    persistentContext: true,
    userDataDirCreated: false,
    executablePath: null,
    headless:
      profile.effectiveBrowserChannel === "chrome"
        ? false
        : requestedHeadless,
  };
}

export function isProcessAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireBrowserProfileLock(
  lockPath,
  metadata,
  options = {}
) {
  const checkProcess =
    options.isProcessAlive || isProcessAlive;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let staleLockRecovered = false;

  if (fs.existsSync(lockPath)) {
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch (error) {
      throw Object.assign(
        new Error(
          `Unreadable browser profile lock must be reviewed manually: ${lockPath}`
        ),
        {
          code: "BROWSER_PROFILE_LOCK_UNREADABLE",
          lockPath,
          cause: error,
        }
      );
    }
    if (
      !Number.isInteger(Number(existing?.pid)) ||
      Number(existing.pid) <= 0
    ) {
      throw Object.assign(
        new Error(
          `Unreadable browser profile lock has no valid owner PID: ${lockPath}`
        ),
        {
          code: "BROWSER_PROFILE_LOCK_UNREADABLE",
          lockPath,
        }
      );
    }
    if (checkProcess(Number(existing.pid))) {
      throw Object.assign(
        new Error(
          `Chrome profile is already in use by another inventory process. Lock: ${lockPath}`
        ),
        {
          code: "BROWSER_PROFILE_LOCK_EXISTS",
          lockPath,
          existing,
        }
      );
    }
    fs.unlinkSync(lockPath);
    staleLockRecovered = true;
  }

  const payload = {
    version: "smokingpipes-browser-profile-lock-v1",
    createdAt: new Date().toISOString(),
    pid: process.pid,
    ...metadata,
  };
  const descriptor = fs.openSync(lockPath, "wx");
  fs.writeFileSync(
    descriptor,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  fs.closeSync(descriptor);
  return {
    lockPath,
    runId: payload.runId,
    staleLockRecovered,
  };
}

export function releaseBrowserProfileLock(lock) {
  if (!lock?.lockPath || !fs.existsSync(lock.lockPath)) return;
  try {
    const payload = JSON.parse(
      fs.readFileSync(lock.lockPath, "utf8")
    );
    if (
      lock.runId &&
      payload.runId &&
      payload.runId !== lock.runId
    ) {
      return;
    }
  } catch {
    return;
  }
  fs.unlinkSync(lock.lockPath);
}

export function classifyBrowserProfileLaunchError(
  error,
  browserDescriptor
) {
  const message =
    error instanceof Error ? error.message : String(error || "");
  if (
    browserDescriptor?.profileLockRequired &&
    /processsingleton|singletonlock|profile.*(?:in use|locked)|user data directory is already in use|failed to create.*lock/i.test(
      message
    )
  ) {
    return Object.assign(
      new Error(
        `Chrome browser profile is already in use: ${browserDescriptor.profileDir}`
      ),
      {
        code: "BROWSER_PROFILE_IN_USE",
        profileDir: browserDescriptor.profileDir,
        cause: error,
      }
    );
  }
  return error;
}
