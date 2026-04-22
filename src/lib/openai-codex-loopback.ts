import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  DEFAULT_OPENAI_CODEX_REDIRECT_URI,
  OPENAI_CODEX_AUTH_COOKIE,
  OPENAI_CODEX_LOOPBACK_CALLBACK_PATH,
  OPENAI_CODEX_LOOPBACK_BIND_HOST,
  OPENAI_CODEX_LOOPBACK_HEALTH_PATH,
  OPENAI_CODEX_LOOPBACK_HOST,
  OPENAI_CODEX_LOOPBACK_PORT,
  isOpenAICodexLoopbackRedirectUri,
  parseOpenAICodexCookie,
} from './openai-codex';

const LOOPBACK_HEALTH_BODY = JSON.stringify({ service: 'job-search-openai-codex-loopback' });
const LOOPBACK_SERVER_HEADER = 'x-openai-codex-loopback';
const LOOPBACK_SERVER_VALUE = 'job-search';

let loopbackReadyPromise: Promise<void> | null = null;
let lastKnownAppOrigin = 'http://localhost:3002';

export async function ensureOpenAICodexLoopbackServer(redirectUri: string, appOrigin: string) {
  if (!isOpenAICodexLoopbackRedirectUri(redirectUri)) {
    return;
  }

  lastKnownAppOrigin = appOrigin;

  if (!loopbackReadyPromise) {
    loopbackReadyPromise = startOpenAICodexLoopbackServer().catch((error) => {
      loopbackReadyPromise = null;
      throw error;
    });
  }

  return loopbackReadyPromise;
}

async function startOpenAICodexLoopbackServer() {
  await new Promise<void>((resolve, reject) => {
    const server = createServer((request, response) => {
      void handleOpenAICodexLoopbackRequest(request, response);
    });

    server.once('error', async (error) => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && await hasCompatibleLoopbackServer()) {
        resolve();
        return;
      }

      reject(new Error(
        `OpenAI Codex OAuth 콜백 포트 ${OPENAI_CODEX_LOOPBACK_PORT}를 사용할 수 없습니다. Codex CLI나 다른 프로세스가 점유 중인지 확인해주세요.`
      ));
    });

    server.listen(OPENAI_CODEX_LOOPBACK_PORT, OPENAI_CODEX_LOOPBACK_BIND_HOST, () => {
      resolve();
    });
  });
}

async function hasCompatibleLoopbackServer() {
  try {
    const response = await fetch(`http://${OPENAI_CODEX_LOOPBACK_HOST}:${OPENAI_CODEX_LOOPBACK_PORT}${OPENAI_CODEX_LOOPBACK_HEALTH_PATH}`, {
      cache: 'no-store',
    });

    return response.ok && response.headers.get(LOOPBACK_SERVER_HEADER) === LOOPBACK_SERVER_VALUE;
  } catch {
    return false;
  }
}

async function handleOpenAICodexLoopbackRequest(request: IncomingMessage, response: ServerResponse) {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', DEFAULT_OPENAI_CODEX_REDIRECT_URI);

  if (method !== 'GET') {
    writeResponse(response, 405, 'Method Not Allowed');
    return;
  }

  if (requestUrl.pathname === OPENAI_CODEX_LOOPBACK_HEALTH_PATH) {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      [LOOPBACK_SERVER_HEADER]: LOOPBACK_SERVER_VALUE,
    });
    response.end(LOOPBACK_HEALTH_BODY);
    return;
  }

  if (requestUrl.pathname !== OPENAI_CODEX_LOOPBACK_CALLBACK_PATH) {
    writeResponse(response, 404, 'Not Found');
    return;
  }

  const cookie = parseOpenAICodexCookie(extractCookie(request.headers.cookie, OPENAI_CODEX_AUTH_COOKIE));
  const appOrigin = cookie?.appOrigin || lastKnownAppOrigin;
  const callbackUrl = new URL('/api/auth/openai/codex/callback', appOrigin);
  callbackUrl.search = requestUrl.search;

  response.writeHead(302, {
    Location: callbackUrl.toString(),
    'Cache-Control': 'no-store',
  });
  response.end();
}

function extractCookie(cookieHeader: string | undefined, cookieName: string) {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) {
      return value.join('=');
    }
  }

  return undefined;
}

function writeResponse(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}
