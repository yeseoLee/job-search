import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/ai';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function getDbSetting(key: string): string | undefined {
  try {
    const dbPath = path.join(process.cwd(), 'data', 'job-search.db');
    if (!fs.existsSync(dbPath)) return undefined;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value || undefined;
    } catch { return undefined; }
    finally { db.close(); }
  } catch { return undefined; }
}

interface JobResult {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  type: string;
  experience: string;
  salary: string;
  deadline: string;
  description: string;
}

interface RallitStatus {
  name?: string;
}

interface RallitRegion {
  code?: string;
  name?: string;
}

interface RallitJob {
  name?: string;
}

interface RallitListItem {
  id: number;
  title?: string;
  companyName?: string;
  addressRegion?: string;
  status?: RallitStatus;
  url?: string;
  jobLevels?: string[];
  jobSkillKeywords?: string[];
}

interface RallitDetail {
  id: number;
  title?: string;
  companyName?: string;
  addressRegion?: string | RallitRegion;
  addressMain?: string;
  status?: RallitStatus;
  endedAt?: string;
  jobs?: RallitJob[];
  jobLevels?: string[];
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  responsibilities?: string;
  content?: string;
  description?: string;
}

interface RallitListResponse {
  data?: {
    items?: RallitListItem[];
  };
}

interface RallitDetailResponse {
  data?: RallitDetail;
}

const RALLIT_LIST_PAGE_SIZE = 20;
const RALLIT_OPEN_ENDED_AT = '9999-12-31';
const RALLIT_REGION_NAMES: Record<string, string> = {
  SEOUL: '서울',
  GANGNAM: '강남',
  MAPO: '마포',
  PANGYO: '판교',
};
const RALLIT_JOB_LEVEL_LABELS: Record<string, string> = {
  BEGINNER: '신입',
  JUNIOR: '주니어',
  MIDDLE: '미들',
  SENIOR: '시니어',
  TOP: '리드',
};

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function dedupeJobs(results: JobResult[]): JobResult[] {
  const seen = new Set<string>();

  return results.filter((job) => {
    const key = `${job.source}:${job.id}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function createSaraminId(jobUrl: string, index: number): string {
  const recIdxMatch = jobUrl.match(/rec_idx=(\d+)/);
  if (recIdxMatch?.[1]) {
    return `saramin-${recIdxMatch[1]}`;
  }

  const viewIdMatch = jobUrl.match(/\/view\/([^?&#/]+)/);
  if (viewIdMatch?.[1]) {
    return `saramin-${viewIdMatch[1]}`;
  }

  return `saramin-${index}`;
}

async function searchKoreanSource(
  searchFn: (query: string) => Promise<JobResult[]>,
  englishQuery: string,
  koreanQuery: string,
  isKoreanQuery: boolean
): Promise<JobResult[]> {
  if (isKoreanQuery || englishQuery === koreanQuery) {
    return searchFn(koreanQuery);
  }

  const [englishResults, koreanResults] = await Promise.allSettled([
    searchFn(englishQuery),
    searchFn(koreanQuery),
  ]);

  return dedupeJobs([
    ...(englishResults.status === 'fulfilled' ? englishResults.value : []),
    ...(koreanResults.status === 'fulfilled' ? koreanResults.value : []),
  ]);
}

// Detect if query contains Korean characters
function hasKorean(text: string): boolean {
  return /[\uAC00-\uD7AF\u1100-\u11FF]/.test(text);
}

// Translate between languages for cross-site search
async function translateQuery(text: string, targetLang: 'en' | 'ko'): Promise<string> {
  try {
    const instruction = targetLang === 'en'
      ? `Translate this Korean job search keyword to a single English search query for job boards.
Return exactly ONE search query, no alternatives, no commas, no "or".
Examples: 퀀트 → quant, 데이터 엔지니어 → data engineer, 주식 퀀트 → equity quant`
      : `Translate this English job search keyword to a single Korean search query for Korean job boards (사람인, 원티드, 랠릿).
Return exactly ONE search query, no alternatives, no commas, no "or".
Use terms that Koreans actually search on job sites.
Examples: equity quant → 퀀트, data engineer → 데이터 엔지니어, machine learning engineer → 머신러닝 엔지니어, frontend developer → 프론트엔드 개발자`;
    const result = await generateText(`${instruction}\n\nKeyword: ${text}\n\nReturn ONLY the single translated keyword:`);
    // Clean up: take only first line, remove quotes, commas, alternatives
    const cleaned = result.text.trim()
      .split('\n')[0]
      .split(',')[0]
      .split(' or ')[0]
      .split(' 또는 ')[0]
      .replace(/^["'`]|["'`]$/g, '')
      .trim();
    return cleaned || text;
  } catch {
    return text;
  }
}

async function searchRallit(q: string): Promise<JobResult[]> {
  try {
    const url = new URL('https://www.rallit.com/client/api/v1/position');
    url.searchParams.set('keyword', q);
    url.searchParams.set('pageNumber', '1');
    url.searchParams.set('pageSize', String(RALLIT_LIST_PAGE_SIZE));

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const data = await res.json() as RallitListResponse;
    const items = data.data?.items || [];
    if (!items.length) return [];

    const details = await Promise.allSettled(
      items.map((item) => fetchRallitDetail(item.id))
    );

    return items.map((item, index) => {
      const detail = details[index];
      return normalizeRallitResult(
        item,
        detail?.status === 'fulfilled' ? detail.value : undefined
      );
    });
  } catch {
    return [];
  }
}

async function fetchRallitDetail(id: number): Promise<RallitDetail | undefined> {
  try {
    const res = await fetch(`https://www.rallit.com/client/api/v1/position/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;

    const data = await res.json() as RallitDetailResponse;
    return data.data;
  } catch {
    return undefined;
  }
}

function normalizeRallitResult(item: RallitListItem, detail?: RallitDetail): JobResult {
  return {
    id: `rallit-${item.id}`,
    title: detail?.title || item.title || '',
    company: detail?.companyName || item.companyName || '',
    location: getRallitLocation(detail, item),
    source: '랠릿',
    url: normalizeRallitUrl(detail?.id || item.id, item.url),
    type: detail?.jobs?.[0]?.name || '-',
    experience: formatRallitExperience(detail?.jobLevels || item.jobLevels),
    salary: formatRallitSalary(detail?.minimumSalary, detail?.maximumSalary),
    deadline: formatRallitDeadline(detail?.endedAt, detail?.status?.name || item.status?.name),
    description: formatRallitDescription(detail, item),
  };
}

function getRallitLocation(detail?: RallitDetail, item?: RallitListItem) {
  if (detail?.addressMain) {
    return detail.addressMain;
  }

  const detailRegion = typeof detail?.addressRegion === 'string'
    ? detail.addressRegion
    : detail?.addressRegion?.name || detail?.addressRegion?.code;
  if (detailRegion) {
    return RALLIT_REGION_NAMES[detailRegion] || detailRegion;
  }

  const listRegion = item?.addressRegion;
  if (listRegion) {
    return RALLIT_REGION_NAMES[listRegion] || listRegion;
  }

  return '-';
}

function formatRallitExperience(jobLevels?: string[]) {
  const labels = (jobLevels || [])
    .map((level) => RALLIT_JOB_LEVEL_LABELS[level] || '')
    .filter(Boolean);

  return labels.length ? labels.join(' / ') : '-';
}

function formatRallitSalary(minimumSalary?: number | null, maximumSalary?: number | null) {
  if (typeof minimumSalary === 'number' && typeof maximumSalary === 'number') {
    return `${Math.round(minimumSalary).toLocaleString()}원 - ${Math.round(maximumSalary).toLocaleString()}원`;
  }

  return '-';
}

function formatRallitDeadline(endedAt?: string, statusName?: string) {
  if (endedAt && endedAt !== RALLIT_OPEN_ENDED_AT) {
    return endedAt.substring(0, 10);
  }

  return statusName || '-';
}

function formatRallitDescription(detail?: RallitDetail, item?: RallitListItem) {
  const descriptionSource = detail?.responsibilities || detail?.content || detail?.description;
  if (descriptionSource) {
    return stripTags(descriptionSource).substring(0, 300);
  }

  if (item?.jobSkillKeywords?.length) {
    return item.jobSkillKeywords.join(', ').substring(0, 300);
  }

  return '';
}

function normalizeRallitUrl(id?: number, url?: string) {
  if (url?.startsWith('http')) {
    return url;
  }

  if (url?.startsWith('/')) {
    return `https://www.rallit.com${url}`;
  }

  if (id) {
    return `https://www.rallit.com/positions/${id}`;
  }

  return 'https://www.rallit.com/positions';
}

async function searchAdzuna(q: string): Promise<JobResult[]> {
  const appId = getDbSetting('ADZUNA_APP_ID') || process.env.ADZUNA_APP_ID;
  const appKey = getDbSetting('ADZUNA_API_KEY') || process.env.ADZUNA_API_KEY;
  if (!appId || !appKey) return [];

  try {
    const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
    url.searchParams.set('app_id', appId);
    url.searchParams.set('app_key', appKey);
    url.searchParams.set('what', q);
    url.searchParams.set('results_per_page', '15');

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || []).map((r: Record<string, unknown>, i: number) => ({
      id: `adzuna-${r.id || i}`,
      title: r.title || '',
      company: (r.company as Record<string, string>)?.display_name || '',
      location: (r.location as Record<string, string>)?.display_name || '',
      source: 'Adzuna',
      url: (r.redirect_url as string) || '',
      type: r.contract_time === 'full_time' ? 'Full-time' : r.contract_time === 'part_time' ? 'Part-time' : '-',
      experience: '-',
      salary: r.salary_min && r.salary_max
        ? `$${Math.round(r.salary_min as number).toLocaleString()} - $${Math.round(r.salary_max as number).toLocaleString()}`
        : '-',
      deadline: '-',
      description: (r.description as string || '').substring(0, 300),
    }));
  } catch {
    return [];
  }
}

async function searchEFinancialCareers(q: string): Promise<JobResult[]> {
  try {
    const url = `https://job-search-api.efinancialcareers.com/v1/efc/jobs/search?culture=us&q=${encodeURIComponent(q)}&pageSize=15&page=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.data || []).map((r: Record<string, unknown>, i: number) => {
      const loc = r.jobLocation as Record<string, string> | undefined;
      const posted = r.postedDate ? new Date(r.postedDate as string) : null;
      const now = new Date();
      let timeAgo = '-';
      if (posted) {
        const diffMs = now.getTime() - posted.getTime();
        const diffH = Math.floor(diffMs / (1000 * 60 * 60));
        const diffD = Math.floor(diffH / 24);
        if (diffD > 0) timeAgo = `${diffD}일 전`;
        else if (diffH > 0) timeAgo = `${diffH}시간 전`;
        else timeAgo = '방금';
      }

      return {
        id: `efc-${r.id || i}`,
        title: (r.title as string) || '',
        company: (r.companyName as string) || (r.clientBrandName as string) || '',
        location: loc ? `${loc.city || ''}, ${loc.country || ''}`.replace(/^,\s*/, '') : '-',
        source: 'eFinancial',
        url: r.detailsPageUrl
          ? `https://www.efinancialcareers.com${r.detailsPageUrl}`
          : '',
        type: (r.employmentType as string) || '-',
        experience: '-',
        salary: (r.salary as string) || '-',
        deadline: timeAgo,
        description: (r.summary as string || '').replace(/<[^>]*>/g, '').substring(0, 300),
      };
    });
  } catch {
    return [];
  }
}

async function searchSaramin(q: string): Promise<JobResult[]> {
  try {
    const url = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(q)}&go=&flag=n&searchMode=1&searchType=search&search_done=y&search_optional_item=n`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results: JobResult[] = [];
    const blocks = html.split('class="area_job"');
    blocks.shift();

    for (let idx = 0; idx < blocks.length && idx < 20; idx++) {
      const block = blocks[idx];
      const titleMatch = block.match(/class="job_tit"[\s\S]*?href="([^"]*)"[\s\S]*?<span>([\s\S]*?)<\/span>/);
      if (!titleMatch) continue;

      const href = titleMatch[1].replace(/&amp;/g, '&');
      const title = stripTags(titleMatch[2]);
      const jobUrl = href.startsWith('http') ? href : `https://www.saramin.co.kr${href}`;

      const companyMatch = block.match(/class="corp_name"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
      const company = companyMatch ? stripTags(companyMatch[1]) : '';

      let location = '-', experience = '-', jobType = '-';
      const conditionMatch = block.match(/class="job_condition">([\s\S]*?)<\/div>/);
      if (conditionMatch) {
        const spans = [...conditionMatch[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
          .map(m => stripTags(m[1]));
        if (spans.length >= 1) location = spans[0] || '-';
        if (spans.length >= 2) experience = spans[1] || '-';
        if (spans.length >= 4) jobType = spans[3] || '-';
      }

      const deadlineMatch = block.match(/class="date">([\s\S]*?)<\/span>/);
      const deadline = deadlineMatch ? stripTags(deadlineMatch[1]) : '-';

      results.push({
        id: createSaraminId(jobUrl, idx), title, company, location,
        source: '사람인', url: jobUrl, type: jobType,
        experience, salary: '-', deadline, description: '',
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function searchWanted(q: string): Promise<JobResult[]> {
  try {
    const url = `https://www.wanted.co.kr/api/v4/jobs?query=${encodeURIComponent(q)}&country=kr&limit=15&offset=0`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.data || []).map((r: Record<string, unknown>, i: number) => {
      const addr = r.address as Record<string, unknown> | undefined;
      const comp = r.company as Record<string, unknown> | undefined;
      return {
        id: `wanted-${r.id || i}`,
        title: (r.position as string) || '',
        company: (comp?.name as string) || '',
        location: (addr?.full_location as string) || (addr?.location as string) || '-',
        source: '원티드',
        url: `https://www.wanted.co.kr/wd/${r.id}`,
        type: '-',
        experience: r.required_experience ? `${r.required_experience}` : '-',
        salary: '-',
        deadline: r.due_time ? String(r.due_time).substring(0, 10) : '-',
        description: '',
      };
    });
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Query required', results: [] }, { status: 400 });
  }

  // Determine Korean and English queries
  const isKorean = hasKorean(q);
  let koreanQuery: string;
  let englishQuery: string;

  if (isKorean) {
    koreanQuery = q;
    englishQuery = await translateQuery(q, 'en');
  } else {
    englishQuery = q;
    koreanQuery = await translateQuery(q, 'ko');
  }

  // Korean sites use the original English query plus the translated Korean query.
  // Korean input keeps the existing single-query behavior.
  const [saraminResults, wantedResults, rallitResults, adzunaResults, efcResults] = await Promise.allSettled([
    searchKoreanSource(searchSaramin, englishQuery, koreanQuery, isKorean),
    searchKoreanSource(searchWanted, englishQuery, koreanQuery, isKorean),
    searchKoreanSource(searchRallit, englishQuery, koreanQuery, isKorean),
    searchAdzuna(englishQuery),
    searchEFinancialCareers(englishQuery),
  ]);

  const results = [
    ...(saraminResults.status === 'fulfilled' ? saraminResults.value : []),
    ...(wantedResults.status === 'fulfilled' ? wantedResults.value : []),
    ...(rallitResults.status === 'fulfilled' ? rallitResults.value : []),
    ...(efcResults.status === 'fulfilled' ? efcResults.value : []),
    ...(adzunaResults.status === 'fulfilled' ? adzunaResults.value : []),
  ];

  return NextResponse.json({
    results,
    count: results.length,
    translatedQuery: isKorean ? `EN: ${englishQuery}` : `KR: ${koreanQuery}`,
    sources: {
      '전체': results.length,
      '사람인': results.filter(r => r.source === '사람인').length,
      '원티드': results.filter(r => r.source === '원티드').length,
      '랠릿': results.filter(r => r.source === '랠릿').length,
      'eFinancial': results.filter(r => r.source === 'eFinancial').length,
      'Adzuna': results.filter(r => r.source === 'Adzuna').length,
    },
  });
}
