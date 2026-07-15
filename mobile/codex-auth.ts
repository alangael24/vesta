import * as SecureStore from "expo-secure-store";

const ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_DEVICE_URL = `${ISSUER}/codex/device`;
export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_IMAGE_EDITS_URL = "https://chatgpt.com/backend-api/codex/images/edits";

const tokenKeys = {
  access: "vesta.experimental-codex.access",
  refresh: "vesta.experimental-codex.refresh",
  expires: "vesta.experimental-codex.expires",
  accountId: "vesta.experimental-codex.account-id",
};

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export type CodexSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
};

export type PendingDeviceAuthorization = {
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
};

export async function getCodexSession(): Promise<CodexSession | null> {
  const [accessToken, refreshToken, expiresValue, accountId] = await Promise.all([
    SecureStore.getItemAsync(tokenKeys.access, secureOptions),
    SecureStore.getItemAsync(tokenKeys.refresh, secureOptions),
    SecureStore.getItemAsync(tokenKeys.expires, secureOptions),
    SecureStore.getItemAsync(tokenKeys.accountId, secureOptions),
  ]);
  const expiresAt = Number(expiresValue);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt)) return null;
  return { accessToken, refreshToken, expiresAt, accountId: accountId || undefined };
}

export async function beginDeviceAuthorization(): Promise<PendingDeviceAuthorization> {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!response.ok) throw new Error(`device_authorization_${response.status}`);
  const payload = await response.json() as {
    device_auth_id?: string;
    user_code?: string;
    interval?: string | number;
  };
  if (!payload.device_auth_id || !payload.user_code) throw new Error("invalid_device_authorization");
  return {
    deviceAuthId: payload.device_auth_id,
    userCode: payload.user_code,
    intervalMs: Math.max(Number(payload.interval) || 5, 1) * 1000 + 3000,
  };
}

export async function completeDeviceAuthorization(pending: PendingDeviceAuthorization): Promise<CodexSession> {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: pending.deviceAuthId,
        user_code: pending.userCode,
      }),
    });
    if (response.ok) {
      const payload = await response.json() as { authorization_code?: string; code_verifier?: string };
      if (!payload.authorization_code || !payload.code_verifier) throw new Error("invalid_device_token");
      const tokens = await exchangeAuthorizationCode(payload.authorization_code, payload.code_verifier);
      return saveTokenResponse(tokens);
    }
    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`device_poll_${response.status}`);
    }
    await delay(pending.intervalMs);
  }
  throw new Error("device_authorization_timeout");
}

export async function logoutCodex(): Promise<void> {
  await Promise.all(Object.values(tokenKeys).map((key) => SecureStore.deleteItemAsync(key, secureOptions)));
}

export async function codexFetch(body: Record<string, unknown>): Promise<Response> {
  let session = await validSession(false);
  let response = await sendCodexRequest(session, body);
  if (response.status === 401) {
    session = await validSession(true);
    response = await sendCodexRequest(session, body);
  }
  return response;
}

export async function codexImageEdit(body: Record<string, unknown>): Promise<Response> {
  let session = await validSession(false);
  let response = await sendCodexImageRequest(session, body);
  if (response.status === 401) {
    session = await validSession(true);
    response = await sendCodexImageRequest(session, body);
  }
  return response;
}

async function validSession(forceRefresh: boolean): Promise<CodexSession> {
  const session = await getCodexSession();
  if (!session) throw new Error("codex_not_connected");
  if (!forceRefresh && session.expiresAt > Date.now() + 60_000) return session;

  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) {
    await logoutCodex();
    throw new Error(`token_refresh_${response.status}`);
  }
  return saveTokenResponse(await response.json() as TokenResponse, session);
}

async function exchangeAuthorizationCode(code: string, verifier: string) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`token_exchange_${response.status}`);
  return response.json() as Promise<TokenResponse>;
}

async function saveTokenResponse(tokens: TokenResponse, previous?: CodexSession): Promise<CodexSession> {
  if (!tokens.access_token) throw new Error("invalid_token_response");
  const refreshToken = tokens.refresh_token || previous?.refreshToken;
  if (!refreshToken) throw new Error("missing_refresh_token");
  const accountId = extractAccountId(tokens.id_token) || extractAccountId(tokens.access_token) || previous?.accountId;
  const session: CodexSession = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId,
  };
  await Promise.all([
    SecureStore.setItemAsync(tokenKeys.access, session.accessToken, secureOptions),
    SecureStore.setItemAsync(tokenKeys.refresh, session.refreshToken, secureOptions),
    SecureStore.setItemAsync(tokenKeys.expires, String(session.expiresAt), secureOptions),
    accountId
      ? SecureStore.setItemAsync(tokenKeys.accountId, accountId, secureOptions)
      : SecureStore.deleteItemAsync(tokenKeys.accountId, secureOptions),
  ]);
  return session;
}

function sendCodexRequest(session: CodexSession, body: Record<string, unknown>) {
  const headers = new Headers({
    Authorization: `Bearer ${session.accessToken}`,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
  if (session.accountId) headers.set("ChatGPT-Account-Id", session.accountId);
  return fetch(CODEX_RESPONSES_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

function sendCodexImageRequest(session: CodexSession, body: Record<string, unknown>) {
  const headers = new Headers({
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  });
  if (session.accountId) headers.set("ChatGPT-Account-Id", session.accountId);
  return fetch(CODEX_IMAGE_EDITS_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

function extractAccountId(token?: string) {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const normalized = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(globalThis.atob(padded)) as {
      chatgpt_account_id?: string;
      organizations?: Array<{ id?: string }>;
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };
    return claims.chatgpt_account_id || claims["https://api.openai.com/auth"]?.chatgpt_account_id || claims.organizations?.[0]?.id;
  } catch {
    return undefined;
  }
}

function formBody(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
