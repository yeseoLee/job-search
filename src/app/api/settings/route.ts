import { getAllSettings, ensureSettingsTable, setSetting, deleteSetting } from '@/lib/settings';
import { getOpenAICodexStatus } from '@/lib/openai-codex';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  ensureSettingsTable();
  const rows = Object.entries(getAllSettings());
  const settings: Record<string, string> = {};
  for (const [key, value] of rows) {
    if (key.startsWith('OPENAI_CODEX_')) {
      continue;
    }

    // Mask API keys for display
    if (key.includes('API_KEY') || key.includes('api_key')) {
      settings[key] = value ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}` : '';
      settings[`${key}_set`] = value ? 'true' : 'false';
    } else {
      settings[key] = key === 'AI_PROVIDER' && value === 'openai' ? 'openai-api' : value;
    }
  }

  const codexStatus = getOpenAICodexStatus();
  settings.OPENAI_CODEX_CONNECTED = codexStatus.connected ? 'true' : 'false';
  settings.OPENAI_CODEX_EXPIRED = codexStatus.expired ? 'true' : 'false';
  settings.OPENAI_CODEX_AUTH_MODE = process.env.OPENAI_CODEX_AUTH_MODE || 'web';
  if (codexStatus.accountId) settings.OPENAI_CODEX_ACCOUNT_ID = codexStatus.accountId;
  if (codexStatus.expiresAt) settings.OPENAI_CODEX_EXPIRES_AT = codexStatus.expiresAt;

  // Also check env vars
  if (process.env.GEMINI_API_KEY) settings['GEMINI_API_KEY_env'] = 'true';
  if (process.env.OPENAI_API_KEY) settings['OPENAI_API_KEY_env'] = 'true';
  if (process.env.ADZUNA_APP_ID) settings['ADZUNA_APP_ID_env'] = 'true';
  if (process.env.ADZUNA_API_KEY) settings['ADZUNA_API_KEY_env'] = 'true';

  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, value } = body;

  if (!key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }

  const allowedKeys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_API_KEY', 'AI_PROVIDER'];
  if (!allowedKeys.includes(key)) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
  }

  if (value) {
    if (key === 'AI_PROVIDER' && !['gemini', 'openai-api', 'openai-codex', 'openai', 'auto'].includes(value)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    setSetting(key, value);
  } else {
    deleteSetting(key);
  }

  return NextResponse.json({ success: true });
}
