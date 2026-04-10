'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Key, Database, Save, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale } from '@/components/layout/locale-context';

interface Settings {
  [key: string]: string;
}

export default function SettingsPage() {
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<Settings>({});
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [adzunaAppId, setAdzunaAppId] = useState('');
  const [adzunaApiKey, setAdzunaApiKey] = useState('');
  const [provider, setProvider] = useState('auto');
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [saving, setSaving] = useState('');

  const refreshSettings = async () => {
    const data = await (await fetch('/api/settings', { cache: 'no-store' })).json();
    setSettings(data);
    setProvider(data.AI_PROVIDER || 'auto');
  };

  useEffect(() => {
    setMounted(true);
    refreshSettings();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const codexStatus = searchParams.get('codex');
    if (!codexStatus) return;

    if (codexStatus === 'connected') {
      toast.success('OpenAI Codex 연결 완료');
    } else {
      toast.error(searchParams.get('message') || 'OpenAI Codex 연결 실패');
    }

    refreshSettings();
    window.history.replaceState({}, '', '/settings');
  }, []);

  const saveKey = async (key: string, value: string, label: string) => {
    setSaving(key);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        toast.success(`${label} 저장 완료`);
        await refreshSettings();
        // Clear input after save
        if (key === 'GEMINI_API_KEY') setGeminiKey('');
        if (key === 'OPENAI_API_KEY') setOpenaiKey('');
        if (key === 'ADZUNA_APP_ID') setAdzunaAppId('');
        if (key === 'ADZUNA_API_KEY') setAdzunaApiKey('');
      } else {
        toast.error('저장 실패');
      }
    } catch {
      toast.error('저장 실패');
    } finally {
      setSaving('');
    }
  };

  const deleteKey = async (key: string, label: string) => {
    setSaving(key);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: '' }),
      });
      toast.success(`${label} 삭제됨`);
      await refreshSettings();
    } catch {
      toast.error('삭제 실패');
    } finally {
      setSaving('');
    }
  };

  const connectCodex = () => {
    setSaving('OPENAI_CODEX_OAUTH');
    window.location.assign('/api/auth/openai/codex/start');
  };

  const disconnectCodex = async () => {
    setSaving('OPENAI_CODEX_OAUTH');
    try {
      const response = await fetch('/api/auth/openai/codex/disconnect', { method: 'POST' });
      if (!response.ok) throw new Error();
      toast.success('OpenAI Codex 연결 해제됨');
      await refreshSettings();
    } catch {
      toast.error('OpenAI Codex 연결 해제 실패');
    } finally {
      setSaving('');
    }
  };

  const isKeySet = (key: string) => settings[`${key}_set`] === 'true' || settings[`${key}_env`] === 'true';
  const getKeyDisplay = (key: string) => {
    if (settings[key] && settings[`${key}_set`] === 'true') return settings[key];
    if (settings[`${key}_env`] === 'true') return '(환경변수에서 로드됨)';
    return '';
  };
  const codexConnected = settings.OPENAI_CODEX_CONNECTED === 'true';
  const codexExpired = settings.OPENAI_CODEX_EXPIRED === 'true';
  const codexAccount = settings.OPENAI_CODEX_ACCOUNT_ID || '';
  const codexExpiresAt = settings.OPENAI_CODEX_EXPIRES_AT || '';
  const codexExpiryText = mounted && codexExpiresAt ? new Date(codexExpiresAt).toLocaleString() : '';
  const codexAuthMode = settings.OPENAI_CODEX_AUTH_MODE || 'web';
  const codexUsesLocalHostAuth = codexAuthMode === 'local-host';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('settingsTitle')}</h2>
        <p className="text-muted-foreground">{t('settingsDesc')}</p>
      </div>

      <div className="grid gap-6 max-w-2xl">
        {/* AI Provider Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              AI Provider
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label>사용할 AI 선택</Label>
              <Select value={provider} onValueChange={(v) => {
                if (!v) return;
                setProvider(v);
                saveKey('AI_PROVIDER', v === 'auto' ? '' : v, 'AI Provider');
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-codex">OpenAI Codex (gpt-5.4-mini, ChatGPT OAuth)</SelectItem>
                  <SelectItem value="auto">자동 (OpenAI Codex 우선)</SelectItem>
                  <SelectItem value="gemini">Gemini (gemini-3-flash-preview)</SelectItem>
                  <SelectItem value="openai-api">OpenAI API (gpt-5.4-mini)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Gemini API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Gemini API Key</Label>
                {isKeySet('GEMINI_API_KEY') && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-xs">
                    <CheckCircle className="h-3 w-3 mr-1" />설정됨
                  </Badge>
                )}
              </div>
              {isKeySet('GEMINI_API_KEY') && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded px-3 py-2">
                  <span className="font-mono">{getKeyDisplay('GEMINI_API_KEY')}</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => deleteKey('GEMINI_API_KEY', 'Gemini API Key')}>
                    삭제
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showGemini ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIza..."
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowGemini(!showGemini)}>
                    {showGemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button onClick={() => saveKey('GEMINI_API_KEY', geminiKey, 'Gemini API Key')} disabled={!geminiKey || saving === 'GEMINI_API_KEY'}>
                  <Save className="h-4 w-4 mr-1" />저장
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google AI Studio</a>에서 무료 발급
              </p>
            </div>

            {/* OpenAI Codex OAuth */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>OpenAI Codex (ChatGPT OAuth)</Label>
                  <p className="text-xs text-muted-foreground">
                    실험적 기능입니다. ChatGPT/Codex 구독 계정으로 인증하며 API Key를 사용하지 않습니다.
                  </p>
                </div>
                <Badge className={codexConnected
                  ? codexExpired
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300 text-xs'
                    : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-xs'
                  : 'text-xs'
                }>
                  {codexConnected ? (codexExpired ? '만료됨' : '연결됨') : '미연결'}
                </Badge>
              </div>

              <div className="rounded-md border bg-muted/50 px-3 py-3 text-xs text-muted-foreground space-y-1">
                <p>기본 모델: <span className="font-mono">gpt-5.4-mini</span></p>
                <p>필수 조건: ChatGPT Plus/Pro/Business/Enterprise 등 Codex 사용 권한이 있는 계정</p>
                <p>기본 OAuth 콜백: <span className="font-mono">http://localhost:1455/auth/callback</span></p>
                <p>토큰 저장 위치: <span className="font-mono">data/job-search.db</span></p>
                {codexAccount && <p>계정 힌트: <span className="font-mono">{codexAccount}</span></p>}
                {codexExpiryText && <p>토큰 만료: {codexExpiryText}</p>}
                <p>Codex CLI 등 다른 앱이 포트 1455를 사용 중이면 인증이 실패할 수 있습니다.</p>
                {codexUsesLocalHostAuth && <p>Docker 모드에서는 웹 버튼 대신 호스트 터미널에서 <span className="font-mono">npm run auth:codex</span> 를 실행해야 합니다.</p>}
                <p>명시적으로 OpenAI Codex를 선택하면 OAuth가 실패할 때 API Key로 자동 전환되지 않습니다.</p>
              </div>

              {codexUsesLocalHostAuth ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-dashed bg-background px-3 py-3 text-xs text-muted-foreground space-y-2">
                    <p>1. 호스트 터미널에서 아래 명령으로 브라우저 인증을 진행하세요.</p>
                    <p className="font-mono rounded bg-muted px-2 py-1">npm run auth:codex</p>
                    <p>2. 인증이 끝나면 이 페이지를 새로고침하거나 상태 새로고침 버튼을 누르세요.</p>
                    <p>3. Docker 컨테이너는 공유된 <span className="font-mono">data/job-search.db</span> 의 토큰을 그대로 사용합니다.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => { void refreshSettings(); }}>
                      상태 새로고침
                    </Button>
                    {codexConnected && (
                      <Button variant="outline" onClick={disconnectCodex} disabled={saving === 'OPENAI_CODEX_OAUTH'}>
                        연결 해제
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={connectCodex} disabled={saving === 'OPENAI_CODEX_OAUTH'}>
                    {codexConnected ? '다시 연결' : 'ChatGPT로 연결'}
                  </Button>
                  {codexConnected && (
                    <Button variant="outline" onClick={disconnectCodex} disabled={saving === 'OPENAI_CODEX_OAUTH'}>
                      연결 해제
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* OpenAI API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>OpenAI API Key</Label>
                  <p className="text-xs text-muted-foreground">
                    사용량 기반 OpenAI Platform 인증입니다. OpenAI Codex OAuth와 별도로 관리됩니다.
                  </p>
                </div>
                {isKeySet('OPENAI_API_KEY') && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-xs">
                    <CheckCircle className="h-3 w-3 mr-1" />설정됨
                  </Badge>
                )}
              </div>
              {isKeySet('OPENAI_API_KEY') && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded px-3 py-2">
                  <span className="font-mono">{getKeyDisplay('OPENAI_API_KEY')}</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => deleteKey('OPENAI_API_KEY', 'OpenAI API Key')}>
                    삭제
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showOpenai ? 'text' : 'password'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowOpenai(!showOpenai)}>
                    {showOpenai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button onClick={() => saveKey('OPENAI_API_KEY', openaiKey, 'OpenAI API Key')} disabled={!openaiKey || saving === 'OPENAI_API_KEY'}>
                  <Save className="h-4 w-4 mr-1" />저장
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">OpenAI Platform</a>에서 발급
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Adzuna Keys */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              채용 검색 API (선택사항)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Adzuna App ID</Label>
                {isKeySet('ADZUNA_APP_ID') && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-xs">설정됨</Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Input value={adzunaAppId} onChange={(e) => setAdzunaAppId(e.target.value)} placeholder="App ID" />
                <Button onClick={() => saveKey('ADZUNA_APP_ID', adzunaAppId, 'Adzuna App ID')} disabled={!adzunaAppId || saving === 'ADZUNA_APP_ID'}>
                  <Save className="h-4 w-4 mr-1" />저장
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Adzuna API Key</Label>
                {isKeySet('ADZUNA_API_KEY') && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-xs">설정됨</Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Input value={adzunaApiKey} onChange={(e) => setAdzunaApiKey(e.target.value)} placeholder="API Key" />
                <Button onClick={() => saveKey('ADZUNA_API_KEY', adzunaApiKey, 'Adzuna API Key')} disabled={!adzunaApiKey || saving === 'ADZUNA_API_KEY'}>
                  <Save className="h-4 w-4 mr-1" />저장
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <a href="https://developer.adzuna.com/" target="_blank" rel="noopener noreferrer" className="text-primary underline">developer.adzuna.com</a>에서 무료 발급
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Data Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              {t('data')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('dataDbInfo')} <code className="bg-muted px-1 rounded">data/job-search.db</code>
            </p>
            <p className="text-sm text-muted-foreground">
              API 키와 OpenAI Codex OAuth 토큰은 로컬 데이터베이스에 저장되며, 설정 API는 OAuth 원문 토큰을 반환하지 않습니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
