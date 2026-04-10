import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { generateOpenAICodexText, ensureOpenAICodexAccessToken, getOpenAICodexStatus } from './openai-codex';
import { getSetting } from './settings';

type Provider = 'gemini' | 'openai-api' | 'openai-codex';
type ProviderPreference = 'auto' | Provider;

interface AiResponse {
  text: string;
}

interface ProviderResult {
  provider: Provider;
  geminiKey?: string;
  openaiApiKey?: string;
  openaiCodexAccessToken?: string;
}

function getGeminiKey() {
  return getSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
}

function getOpenAIApiKey() {
  return getSetting('OPENAI_API_KEY') || process.env.OPENAI_API_KEY;
}

function normalizeProviderPreference(value?: string): ProviderPreference {
  switch (value) {
    case 'gemini':
      return 'gemini';
    case 'openai':
    case 'openai-api':
      return 'openai-api';
    case 'openai-codex':
      return 'openai-codex';
    default:
      return 'auto';
  }
}

async function getProvider(): Promise<ProviderResult> {
  const geminiKey = getGeminiKey();
  const openaiApiKey = getOpenAIApiKey();
  const preferredProvider = normalizeProviderPreference(getSetting('AI_PROVIDER'));

  if (preferredProvider === 'gemini') {
    if (!geminiKey) throw new Error('Gemini API Key를 설정해주세요.');
    return { provider: 'gemini', geminiKey };
  }

  if (preferredProvider === 'openai-api') {
    if (!openaiApiKey) throw new Error('OpenAI API Key를 설정해주세요.');
    return { provider: 'openai-api', openaiApiKey };
  }

  if (preferredProvider === 'openai-codex') {
    const accessToken = await ensureOpenAICodexAccessToken();
    return { provider: 'openai-codex', openaiCodexAccessToken: accessToken };
  }

  try {
    const accessToken = await ensureOpenAICodexAccessToken();
    return { provider: 'openai-codex', openaiCodexAccessToken: accessToken };
  } catch {
    // Auto mode may continue to Gemini or API-key OpenAI.
  }

  if (geminiKey) {
    return { provider: 'gemini', geminiKey };
  }

  if (openaiApiKey) {
    return { provider: 'openai-api', openaiApiKey };
  }

  throw new Error('OpenAI Codex OAuth, Gemini API Key, 또는 OpenAI API Key를 설정해주세요.');
}

export function getProviderName(): string {
  const preferredProvider = normalizeProviderPreference(getSetting('AI_PROVIDER'));

  if (preferredProvider === 'gemini') return 'Gemini';
  if (preferredProvider === 'openai-codex') return 'OpenAI Codex';
  if (preferredProvider === 'openai-api') return 'OpenAI API';
  if (getOpenAICodexStatus().connected) return 'OpenAI Codex';
  if (getGeminiKey()) return 'Gemini';
  if (getOpenAIApiKey()) return 'OpenAI API';
  return 'Not configured';
}

export async function generateText(prompt: string): Promise<AiResponse> {
  const { provider, geminiKey, openaiApiKey, openaiCodexAccessToken } = await getProvider();

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(geminiKey!);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const result = await model.generateContent(prompt);
    return { text: result.response.text() };
  }

  if (provider === 'openai-codex') {
    return { text: await generateOpenAICodexText(prompt, { accessToken: openaiCodexAccessToken }) };
  }

  const openai = new OpenAI({ apiKey: openaiApiKey! });
  const result = await openai.chat.completions.create({
    model: 'gpt-5.4-mini',
    messages: [{ role: 'user', content: prompt }],
  });
  return { text: result.choices[0]?.message?.content || '' };
}

export async function generateJson(prompt: string): Promise<AiResponse> {
  const { provider, geminiKey, openaiApiKey, openaiCodexAccessToken } = await getProvider();

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(geminiKey!);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    return { text: result.response.text() };
  }

  if (provider === 'openai-codex') {
    return {
      text: await generateOpenAICodexText(prompt, {
        accessToken: openaiCodexAccessToken,
        expectJson: true,
      }),
    };
  }

  const openai = new OpenAI({ apiKey: openaiApiKey! });
  const result = await openai.chat.completions.create({
    model: 'gpt-5.4-mini',
    messages: [{ role: 'user', content: prompt + '\n\nReturn ONLY valid JSON, no markdown or extra text.' }],
    response_format: { type: 'json_object' },
  });
  return { text: result.choices[0]?.message?.content || '{}' };
}

export function getAiErrorMessage(error: unknown): string {
  return `AI provider error: ${error instanceof Error ? error.message : 'Unknown error'}`;
}
