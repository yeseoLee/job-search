import { NextRequest, NextResponse } from 'next/server';
import {
  OPENAI_CODEX_AUTH_COOKIE,
  exchangeOpenAICodexCode,
  parseOpenAICodexCookie,
  storeOpenAICodexTokens,
} from '@/lib/openai-codex';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const cookie = parseOpenAICodexCookie(request.cookies.get(OPENAI_CODEX_AUTH_COOKIE)?.value);
  const redirectUrl = new URL('/settings', cookie?.appOrigin || request.nextUrl.origin);

  const cleanupAndRedirect = (status: 'connected' | 'error', message?: string) => {
    redirectUrl.searchParams.set('codex', status);
    if (message) redirectUrl.searchParams.set('message', message);

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(OPENAI_CODEX_AUTH_COOKIE);
    return response;
  };

  const error = request.nextUrl.searchParams.get('error');
  const errorDescription = request.nextUrl.searchParams.get('error_description');
  if (error) {
    return cleanupAndRedirect('error', errorDescription || error);
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  if (!cookie) {
    return cleanupAndRedirect('error', 'OAuth state가 만료되었습니다. 다시 시도해주세요.');
  }

  if (!code || !state || state !== cookie.state) {
    return cleanupAndRedirect('error', 'OAuth 콜백 검증에 실패했습니다.');
  }

  try {
    const tokens = await exchangeOpenAICodexCode({
      code,
      codeVerifier: cookie.codeVerifier,
      redirectUri: cookie.redirectUri,
    });

    storeOpenAICodexTokens(tokens);
    return cleanupAndRedirect('connected');
  } catch (authError) {
    return cleanupAndRedirect(
      'error',
      authError instanceof Error ? authError.message : 'OpenAI Codex 인증에 실패했습니다.'
    );
  }
}
