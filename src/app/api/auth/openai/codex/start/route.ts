import { NextRequest, NextResponse } from 'next/server';
import {
  OPENAI_CODEX_AUTH_COOKIE,
  buildOpenAICodexAuthorizeUrl,
  createOpenAICodexPkce,
  getOpenAICodexRedirectUri,
  serializeOpenAICodexCookie,
} from '@/lib/openai-codex';
import { ensureOpenAICodexLoopbackServer } from '@/lib/openai-codex-loopback';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (process.env.OPENAI_CODEX_AUTH_MODE === 'local-host') {
    const errorUrl = new URL('/settings', request.nextUrl.origin);
    errorUrl.searchParams.set('codex', 'error');
    errorUrl.searchParams.set(
      'message',
      'Docker 실행 중에는 호스트 터미널에서 npm run auth:codex 를 실행해주세요.'
    );
    return NextResponse.redirect(errorUrl);
  }

  const { codeVerifier, codeChallenge, state } = createOpenAICodexPkce();
  const redirectUri = getOpenAICodexRedirectUri();

  try {
    await ensureOpenAICodexLoopbackServer(redirectUri, request.nextUrl.origin);
  } catch (error) {
    const errorUrl = new URL('/settings', request.nextUrl.origin);
    errorUrl.searchParams.set('codex', 'error');
    errorUrl.searchParams.set(
      'message',
      error instanceof Error ? error.message : 'OpenAI Codex OAuth 초기화에 실패했습니다.'
    );
    return NextResponse.redirect(errorUrl);
  }

  const authorizeUrl = buildOpenAICodexAuthorizeUrl({ codeChallenge, redirectUri, state });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(
    OPENAI_CODEX_AUTH_COOKIE,
    serializeOpenAICodexCookie({
      appOrigin: request.nextUrl.origin,
      codeVerifier,
      redirectUri,
      state,
    }),
    {
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/',
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    }
  );

  return response;
}
