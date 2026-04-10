import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const OPENAI_CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_SCOPE = 'openid profile email offline_access';
const DEFAULT_OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const DEFAULT_OPENAI_CODEX_APP_ORIGIN = 'http://localhost:3001';
const SETTINGS_KEYS = {
  accessToken: 'OPENAI_CODEX_ACCESS_TOKEN',
  refreshToken: 'OPENAI_CODEX_REFRESH_TOKEN',
  expiresAt: 'OPENAI_CODEX_EXPIRES_AT',
  accountId: 'OPENAI_CODEX_ACCOUNT_ID',
};

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const redirectUri = process.env.OPENAI_CODEX_REDIRECT_URI || DEFAULT_OPENAI_CODEX_REDIRECT_URI;
const appOrigin = process.env.OPENAI_CODEX_APP_ORIGIN || DEFAULT_OPENAI_CODEX_APP_ORIGIN;
const dbPath = process.env.OPENAI_CODEX_DB_PATH || path.join(repoRoot, 'data', 'job-search.db');
const clientId = process.env.OPENAI_CODEX_CLIENT_ID || DEFAULT_OPENAI_CODEX_CLIENT_ID;
const callbackUrl = new URL(redirectUri);

async function main() {
  const { codeVerifier, codeChallenge, state } = createPkce();
  const authorizeUrl = buildAuthorizeUrl({ clientId, codeChallenge, redirectUri, state });

  console.log('');
  console.log('OpenAI Codex OAuth 로컬 인증을 시작합니다.');
  console.log(`- Redirect URI: ${redirectUri}`);
  console.log(`- App Origin:   ${appOrigin}`);
  console.log(`- DB Path:      ${dbPath}`);
  console.log('');

  const callbackWaiter = listenForCallback({
    appOrigin,
    clientId,
    codeVerifier,
    dbPath,
    redirectUri,
    state,
  });

  console.log('브라우저에서 로그인 페이지를 엽니다. 열리지 않으면 아래 URL을 직접 여세요.');
  console.log(authorizeUrl);
  console.log('');
  openBrowser(authorizeUrl);

  await callbackWaiter;
  console.log('OpenAI Codex OAuth 토큰을 로컬 DB에 저장했습니다.');
}

async function listenForCallback({ appOrigin, clientId, codeVerifier, dbPath, redirectUri, state }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      closeWithError(new Error('인증 대기 시간이 초과되었습니다. 다시 시도해주세요.'));
    }, 5 * 60 * 1000);

    const server = createServer((request, response) => {
      void handleCallback(request, response);
    });

    server.on('error', (error) => {
      closeWithError(
        new Error(
          `포트 ${callbackUrl.port || '1455'} 에서 로컬 콜백 서버를 시작하지 못했습니다. Codex CLI나 다른 프로세스가 사용 중인지 확인해주세요.`
        )
      );
      if (error) {
        // Keep the original error visible for shell users.
        console.error(error);
      }
    });

    server.listen(Number(callbackUrl.port || 1455), () => {
      console.log(`로컬 콜백 서버가 ${redirectUri} 에서 대기 중입니다.`);
    });

    async function handleCallback(request, response) {
      try {
        const requestUrl = new URL(request.url || '/', redirectUri);

        if (request.method !== 'GET' || requestUrl.pathname !== callbackUrl.pathname) {
          writeHtml(response, 404, renderHtml({
            title: 'OpenAI Codex OAuth',
            body: '잘못된 콜백 경로입니다.',
          }));
          return;
        }

        const errorDescription = requestUrl.searchParams.get('error_description');
        const oauthError = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code');
        const returnedState = requestUrl.searchParams.get('state');

        if (oauthError) {
          const message = errorDescription || `인증이 실패했습니다 (${oauthError}).`;
          writeHtml(response, 400, renderHtml({
            title: 'OpenAI Codex OAuth 실패',
            body: message,
            redirectUrl: buildSettingsUrl(appOrigin, 'error', message),
          }));
          closeWithError(new Error(message));
          return;
        }

        if (!code || !returnedState || returnedState !== state) {
          const message = 'OAuth state 검증에 실패했습니다. 다시 시도해주세요.';
          writeHtml(response, 400, renderHtml({
            title: 'OpenAI Codex OAuth 실패',
            body: message,
            redirectUrl: buildSettingsUrl(appOrigin, 'error', message),
          }));
          closeWithError(new Error(message));
          return;
        }

        const tokens = await exchangeCode({
          clientId,
          code,
          codeVerifier,
          redirectUri,
        });

        storeTokens(dbPath, tokens);

        writeHtml(response, 200, renderHtml({
          title: 'OpenAI Codex 연결 완료',
          body: '토큰을 로컬 데이터베이스에 저장했습니다. 잠시 후 설정 페이지로 돌아갑니다.',
          redirectUrl: buildSettingsUrl(appOrigin, 'connected'),
        }));
        closeSuccessfully();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OpenAI Codex 인증에 실패했습니다.';
        writeHtml(response, 500, renderHtml({
          title: 'OpenAI Codex OAuth 실패',
          body: message,
          redirectUrl: buildSettingsUrl(appOrigin, 'error', message),
        }));
        closeWithError(new Error(message));
      }
    }

    function closeSuccessfully() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      server.close(() => resolve());
    }

    function closeWithError(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      server.close(() => reject(error));
    }
  });
}

function buildAuthorizeUrl({ clientId, codeChallenge, redirectUri, state }) {
  const search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: OPENAI_CODEX_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  });

  return `${OPENAI_CODEX_AUTHORIZE_URL}?${search.toString()}`;
}

async function exchangeCode({ clientId, code, codeVerifier, redirectUri }) {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `토큰 교환에 실패했습니다 (${response.status}).`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('토큰 응답에 access_token 이 없습니다.');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : undefined,
    accountId: extractAccountId(payload.access_token, payload.id_token),
  };
}

function storeTokens(dbPath, tokens) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');
  const transaction = db.transaction(() => {
    insert.run(SETTINGS_KEYS.accessToken, tokens.accessToken);
    if (tokens.refreshToken) insert.run(SETTINGS_KEYS.refreshToken, tokens.refreshToken);
    else remove.run(SETTINGS_KEYS.refreshToken);

    if (tokens.expiresAt) insert.run(SETTINGS_KEYS.expiresAt, tokens.expiresAt);
    else remove.run(SETTINGS_KEYS.expiresAt);

    if (tokens.accountId) insert.run(SETTINGS_KEYS.accountId, tokens.accountId);
    else remove.run(SETTINGS_KEYS.accountId);
  });

  transaction();
  db.close();
}

function createPkce() {
  const codeVerifier = base64UrlEncode(randomBytes(48));
  const state = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());

  return { codeVerifier, state, codeChallenge };
}

function extractAccountId(accessToken, idToken) {
  const accessPayload = decodeJwtPayload(accessToken);
  const idPayload = decodeJwtPayload(idToken);

  return readAccountHint(accessPayload) || readAccountHint(idPayload);
}

function readAccountHint(payload) {
  if (!payload) return undefined;

  const candidates = [
    payload.email,
    payload.preferred_username,
    payload.sub,
    payload.account_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function decodeJwtPayload(token) {
  if (!token) return undefined;

  try {
    const [, payload] = token.split('.');
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

function buildSettingsUrl(appOrigin, status, message) {
  const url = new URL('/settings', appOrigin);
  url.searchParams.set('codex', status);
  if (message) {
    url.searchParams.set('message', message);
  }
  return url.toString();
}

function renderHtml({ title, body, redirectUrl }) {
  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body);
  const escapedRedirect = redirectUrl ? escapeHtml(redirectUrl) : '';
  const metaRefresh = redirectUrl ? `<meta http-equiv="refresh" content="1;url=${escapedRedirect}">` : '';
  const link = redirectUrl ? `<p><a href="${escapedRedirect}">설정 페이지로 돌아가기</a></p>` : '';

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedTitle}</title>
    ${metaRefresh}
  </head>
  <body style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem;">
    <h1>${escapedTitle}</h1>
    <p>${escapedBody}</p>
    ${link}
  </body>
</html>`;
}

function writeHtml(response, status, html) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(html);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openBrowser(url) {
  const commands = process.platform === 'darwin'
    ? [['open', url]]
    : process.platform === 'win32'
      ? [['cmd.exe', '/c', 'start', '', url]]
      : [['wslview', url], ['xdg-open', url]];

  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, {
      stdio: 'ignore',
    });
    if (!result.error && result.status === 0) {
      return;
    }
  }
}

function loadEnvFile() {
  const envPath = path.resolve(repoRootFromScript(), '.env.local');

  try {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key]) continue;

      process.env[key] = stripQuotes(rawValue);
    }
  } catch {
    // Ignore a missing .env.local file.
  }
}

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function base64UrlEncode(value) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
