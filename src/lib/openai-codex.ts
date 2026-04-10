import { createHash, randomBytes } from 'node:crypto';
import { deleteSettings, getSetting, setSetting } from './settings';

export const DEFAULT_OPENAI_CODEX_MODEL = 'gpt-5.4-mini';
export const DEFAULT_OPENAI_CODEX_CLIENT_ID = process.env.OPENAI_CODEX_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_CODEX_AUTH_COOKIE = 'openai_codex_oauth';
export const OPENAI_CODEX_LOOPBACK_HOST = 'localhost';
export const OPENAI_CODEX_LOOPBACK_BIND_HOST = process.env.OPENAI_CODEX_LOOPBACK_BIND_HOST || OPENAI_CODEX_LOOPBACK_HOST;
export const OPENAI_CODEX_LOOPBACK_PORT = 1455;
export const OPENAI_CODEX_LOOPBACK_CALLBACK_PATH = '/auth/callback';
export const OPENAI_CODEX_LOOPBACK_HEALTH_PATH = '/healthz';
export const DEFAULT_OPENAI_CODEX_REDIRECT_URI = `http://${OPENAI_CODEX_LOOPBACK_HOST}:${OPENAI_CODEX_LOOPBACK_PORT}${OPENAI_CODEX_LOOPBACK_CALLBACK_PATH}`;

const OPENAI_CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const OPENAI_CODEX_SCOPE = 'openid profile email offline_access';
const OPENAI_CODEX_TOKEN_SKEW_MS = 60 * 1000;
const RAW_OPENAI_CODEX_KEYS = [
  'OPENAI_CODEX_ACCESS_TOKEN',
  'OPENAI_CODEX_REFRESH_TOKEN',
  'OPENAI_CODEX_EXPIRES_AT',
  'OPENAI_CODEX_ACCOUNT_ID',
] as const;

interface TokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

interface StoredOpenAICodexTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  accountId?: string;
}

interface OpenAICodexCookieState {
  appOrigin: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
}

export function getOpenAICodexRedirectUri(): string {
  return process.env.OPENAI_CODEX_REDIRECT_URI || DEFAULT_OPENAI_CODEX_REDIRECT_URI;
}

export function isOpenAICodexLoopbackRedirectUri(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri);
    return (
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname) &&
      parsed.pathname === OPENAI_CODEX_LOOPBACK_CALLBACK_PATH
    );
  } catch {
    return false;
  }
}

export function createOpenAICodexPkce() {
  const codeVerifier = base64UrlEncode(randomBytes(48));
  const state = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());

  return { codeVerifier, state, codeChallenge };
}

export function buildOpenAICodexAuthorizeUrl(params: {
  codeChallenge: string;
  redirectUri: string;
  state: string;
  clientId?: string;
}) {
  const search = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId || DEFAULT_OPENAI_CODEX_CLIENT_ID,
    redirect_uri: params.redirectUri,
    scope: OPENAI_CODEX_SCOPE,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  });

  return `${OPENAI_CODEX_AUTHORIZE_URL}?${search.toString()}`;
}

export function serializeOpenAICodexCookie(state: OpenAICodexCookieState): string {
  return base64UrlEncode(Buffer.from(JSON.stringify(state), 'utf8'));
}

export function parseOpenAICodexCookie(value?: string): OpenAICodexCookieState | null {
  if (!value) return null;

  try {
    const normalized = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<OpenAICodexCookieState>;
    if (!parsed.appOrigin || !parsed.codeVerifier || !parsed.redirectUri || !parsed.state) return null;
    return {
      appOrigin: parsed.appOrigin,
      codeVerifier: parsed.codeVerifier,
      redirectUri: parsed.redirectUri,
      state: parsed.state,
    };
  } catch {
    return null;
  }
}

export async function exchangeOpenAICodexCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const response = await exchangeOpenAICodexToken({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: DEFAULT_OPENAI_CODEX_CLIENT_ID,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });

  return normalizeOpenAICodexTokens(response);
}

export async function refreshOpenAICodexTokens(refreshToken: string) {
  const response = await exchangeOpenAICodexToken({
    grant_type: 'refresh_token',
    client_id: DEFAULT_OPENAI_CODEX_CLIENT_ID,
    refresh_token: refreshToken,
  });

  return normalizeOpenAICodexTokens(response);
}

export function storeOpenAICodexTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  accountId?: string;
}) {
  setSetting('OPENAI_CODEX_ACCESS_TOKEN', tokens.accessToken);

  if (tokens.refreshToken) setSetting('OPENAI_CODEX_REFRESH_TOKEN', tokens.refreshToken);
  if (tokens.expiresAt) setSetting('OPENAI_CODEX_EXPIRES_AT', tokens.expiresAt);
  if (tokens.accountId) setSetting('OPENAI_CODEX_ACCOUNT_ID', tokens.accountId);
}

export function clearOpenAICodexTokens() {
  deleteSettings([...RAW_OPENAI_CODEX_KEYS]);
}

export function getStoredOpenAICodexTokens(): StoredOpenAICodexTokens {
  return {
    accessToken: getSetting('OPENAI_CODEX_ACCESS_TOKEN'),
    refreshToken: getSetting('OPENAI_CODEX_REFRESH_TOKEN'),
    expiresAt: getSetting('OPENAI_CODEX_EXPIRES_AT'),
    accountId: getSetting('OPENAI_CODEX_ACCOUNT_ID'),
  };
}

export function getOpenAICodexStatus() {
  const { accessToken, refreshToken, expiresAt, accountId } = getStoredOpenAICodexTokens();
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const expired = Boolean(expiresAt && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now());

  return {
    connected: Boolean(accessToken || refreshToken),
    expired,
    expiresAt,
    accountId,
  };
}

export async function ensureOpenAICodexAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const stored = getStoredOpenAICodexTokens();
  if (!stored.accessToken && !stored.refreshToken) {
    throw new Error('OpenAI Codex OAuth 연결이 필요합니다.');
  }

  const expiresAtMs = stored.expiresAt ? Date.parse(stored.expiresAt) : Number.NaN;
  const tokenUsable = Boolean(
    stored.accessToken &&
    !options?.forceRefresh &&
    (!Number.isFinite(expiresAtMs) || expiresAtMs - OPENAI_CODEX_TOKEN_SKEW_MS > Date.now())
  );

  if (tokenUsable && stored.accessToken) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    clearOpenAICodexTokens();
    throw new Error('OpenAI Codex 토큰이 만료되었습니다. 다시 연결해주세요.');
  }

  try {
    const refreshed = await refreshOpenAICodexTokens(stored.refreshToken);
    storeOpenAICodexTokens({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || stored.refreshToken,
      expiresAt: refreshed.expiresAt,
      accountId: refreshed.accountId || stored.accountId,
    });

    return refreshed.accessToken;
  } catch {
    clearOpenAICodexTokens();
    throw new Error('OpenAI Codex 토큰 갱신에 실패했습니다. 다시 연결해주세요.');
  }
}

export async function generateOpenAICodexText(prompt: string, options?: { expectJson?: boolean; accessToken?: string }) {
  const requestPrompt = options?.expectJson
    ? `${prompt}\n\nReturn ONLY valid JSON, no markdown or extra text.`
    : prompt;

  return callOpenAICodexResponses(requestPrompt, {
    accessToken: options?.accessToken,
  });
}

function base64UrlEncode(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function callOpenAICodexResponses(
  prompt: string,
  options?: { accessToken?: string; retrying?: boolean }
): Promise<string> {
  const accessToken = options?.accessToken || await ensureOpenAICodexAccessToken();
  const response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_CODEX_MODEL,
      instructions: '',
      stream: true,
      reasoning: {
        effort: 'medium',
      },
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
      ],
      store: false,
    }),
  });

  if (response.status === 401 && !options?.retrying) {
    const refreshedAccessToken = await ensureOpenAICodexAccessToken({ forceRefresh: true });
    return callOpenAICodexResponses(prompt, { accessToken: refreshedAccessToken, retrying: true });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(getOpenAICodexHttpError(response.status, errorText));
  }

  return extractOpenAICodexSseText(await response.text());
}

async function exchangeOpenAICodexToken(body: Record<string, string>) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(getOpenAICodexHttpError(response.status, errorText));
  }

  return await response.json() as TokenExchangeResponse;
}

function normalizeOpenAICodexTokens(response: TokenExchangeResponse) {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: response.expires_in ? new Date(Date.now() + response.expires_in * 1000).toISOString() : undefined,
    accountId: extractAccountId(response.access_token, response.id_token),
  };
}

function extractAccountId(accessToken?: string, idToken?: string) {
  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken);

  return (
    readAccountHint(accessPayload) ||
    readAccountHint(idPayload) ||
    undefined
  );
}

function readAccountHint(payload?: Record<string, unknown>) {
  if (!payload) return undefined;

  const candidates = [
    payload.account_id,
    payload.accountId,
    payload.email,
    payload.sub,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function decodeJwtPayload(token?: string) {
  if (!token) return undefined;

  const [, payload] = token.split('.');
  if (!payload) return undefined;

  try {
    const normalized = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function getOpenAICodexHttpError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      error_description?: string;
      message?: string;
    };

    return parsed.error_description || parsed.message || parsed.error || `HTTP ${status}`;
  } catch {
    return body || `HTTP ${status}`;
  }
}

function extractOpenAIResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenAI Codex 응답을 해석할 수 없습니다.');
  }

  const response = payload as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  const outputText = response.output
    ?.flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text || '')
    .join('');

  if (outputText && outputText.trim()) {
    return outputText;
  }

  throw new Error('OpenAI Codex 응답에서 텍스트를 찾을 수 없습니다.');
}

function extractOpenAICodexSseText(rawSse: string): string {
  let outputText = '';
  let completedResponse: unknown;

  for (const block of rawSse.split(/\r?\n\r?\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());

    if (!dataLines.length) continue;

    const data = dataLines.join('\n');
    if (!data || data === '[DONE]') continue;

    try {
      const payload = JSON.parse(data) as {
        type?: string;
        delta?: string;
        error?: { message?: string };
        message?: string;
        response?: unknown;
      };

      if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
        outputText += payload.delta;
      }

      if (payload.type === 'error') {
        throw new Error(payload.error?.message || payload.message || 'OpenAI Codex 스트림 오류');
      }

      if (payload.type === 'response.completed' && payload.response) {
        completedResponse = payload.response;
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
    }
  }

  if (outputText.trim()) {
    return outputText;
  }

  if (completedResponse) {
    return extractOpenAIResponseText(completedResponse);
  }

  throw new Error('OpenAI Codex 스트림 응답에서 텍스트를 찾을 수 없습니다.');
}
