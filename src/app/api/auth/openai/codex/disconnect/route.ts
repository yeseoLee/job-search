import { NextResponse } from 'next/server';
import { clearOpenAICodexTokens } from '@/lib/openai-codex';

export async function POST() {
  clearOpenAICodexTokens();
  return NextResponse.json({ success: true });
}
