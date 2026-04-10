# Job Search Engine

한국/해외 채용 공고를 통합 검색하고, AI로 이력서 적합도 분석 및 맞춤 이력서를 생성하는 웹 애플리케이션입니다.

## Features

### 채용 검색
- **사람인**, **원티드**, **eFinancialCareers**, **Adzuna** 통합 검색
- 한국어 입력 시 자동 영어 번역 → 해외 사이트 동시 검색
- 영어 입력 시 자동 한국어 번역 → 한국 사이트 동시 검색
- 소스별 필터 탭 (전체/사람인/원티드/eFinancial/Adzuna)
- 검색 결과 캐싱 (페이지 이동 후 복귀 시 유지)

### AI 적합도 분석 (Gemini / OpenAI API / OpenAI Codex)
- **적합도 분석 (Gemini)** 버튼으로 전체 공고 일괄 매칭 점수 계산
- **상세** 버튼 클릭 시:
  - 직무 요구사항 분석
  - 이력서 적합도 점수 (0~100점)
  - 상세 분석 및 보완이 필요한 영역
  - 공고 페이지 자동 파싱

### 맞춤 이력서 생성
- 영문/한글 이력서 각각 생성 가능
- Markdown 렌더링으로 깔끔한 표시
- PDF 다운로드 (한글 인코딩 지원)
- 복사 버튼

### 이력서 도구
- PDF/TXT/MD 이력서 업로드
- **매칭 점수** — 이력서 vs 채용 공고 적합도 분석 (일치 기술, 부족 기술, 제안사항)
- **이력서 수정** — 특정 공고에 맞게 이력서 재작성
- **추천 공고** — 이력서 기반 자동 키워드 추출 → 검색 → 매칭 점수 순위

### AI 어시스턴트
- 자기소개서 생성
- 면접 준비 자료 생성
- 채용 공고 분석
- 스킬 갭 분석
- Gemini, OpenAI API, OpenAI Codex 중 설정된 provider 사용

### 기타
- 한국어/English UI 전환
- 다크/라이트 모드
- 반응형 디자인 (모바일 사이드바)

## Tech Stack

| 구분 | 기술 |
|------|------|
| Framework | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Database | SQLite (better-sqlite3) |
| AI | Google Gemini (`gemini-3-flash-preview`), OpenAI API (`gpt-5.4-mini`), OpenAI Codex (`gpt-5.4-mini`) |
| Runtime | Docker + Docker Compose |
| PDF 파싱 | pdf-parse |
| PDF 생성 | 브라우저 Print API (한글 지원) |
| Markdown | react-markdown + @tailwindcss/typography |

## Getting Started

### 1. Clone & Configure

Docker Engine과 Docker Compose가 필요합니다.

```bash
git clone https://github.com/htk1019/job-search.git
cd job-search
cp .env.sample .env.local
```

### 2. AI/API 설정

**방법 A: 설정 페이지에서 직접 연결/입력**

앱 실행 후 **설정** 페이지에서 아래 중 필요한 방식으로 연결하면 로컬 DB에 저장됩니다.

- **Gemini API Key**: 기존 방식
- **OpenAI Codex (ChatGPT OAuth)**: 실험적 기능. Docker 실행 중에는 웹 버튼 대신 호스트 터미널에서 `npm run auth:codex`
- **OpenAI API Key**: OpenAI Platform 사용량 기반 인증

기본 `AI Provider` 우선순위는 다음과 같습니다.

1. `OpenAI Codex`
2. `Gemini`
3. `OpenAI API`

`OpenAI Codex`를 명시적으로 선택한 경우 OAuth가 실패하면 자동으로 API Key로 전환되지 않으며, 다시 연결해야 합니다. `auto` 모드에서만 `OpenAI API`로 폴백합니다.

**방법 B: 환경 변수 파일**

`.env.local` 파일 예시:

```env
# AI Provider - auto 모드 기본 우선순위: OpenAI Codex -> Gemini -> OpenAI API
GEMINI_API_KEY=your-gemini-api-key

# OpenAI Platform API (선택사항, 사용량 기반 과금)
# OPENAI_API_KEY=sk-your-openai-key

# OpenAI Codex OAuth는 설정 페이지에서 연결됩니다.
# 아래 값은 실험적 OAuth 통합을 위한 선택적 override 입니다.
# OPENAI_CODEX_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
# OPENAI_CODEX_REDIRECT_URI=http://localhost:1455/auth/callback
# OPENAI_CODEX_APP_ORIGIN=http://localhost:3001
# Docker Compose는 OPENAI_CODEX_AUTH_MODE=local-host 를 자동 설정합니다.

# 채용 검색 (선택사항)
ADZUNA_APP_ID=your-app-id
ADZUNA_API_KEY=your-api-key
```

| 서비스 | 발급 링크 | 비고 |
|--------|-----------|------|
| Gemini API | [Google AI Studio](https://aistudio.google.com/apikey) | 무료 |
| OpenAI Codex OAuth | ChatGPT/Codex 계정으로 설정 페이지에서 연결 | 실험적, ChatGPT/Codex entitlement 필요 |
| OpenAI API | [OpenAI Platform](https://platform.openai.com/api-keys) | 유료, 사용량 기반 과금 |
| Adzuna API | [developer.adzuna.com](https://developer.adzuna.com/) | 무료 (250건/일) |

> `OpenAI Codex` OAuth는 reference 구현과 동일하게 `http://localhost:1455/auth/callback` 루프백 redirect를 기본값으로 사용합니다. Docker 모드에서는 인증 자체를 호스트에서 처리하고, 결과 토큰만 `./data/job-search.db` 에 저장합니다. Codex CLI 등 다른 프로세스가 포트 `1455`를 점유하면 인증이 실패할 수 있습니다.

### 3. 실행

```bash
docker compose up --build
```

브라우저:

- 앱: http://localhost:3001

OpenAI Codex를 쓰려면 Docker 실행과 별개로 호스트 터미널에서 한 번 인증합니다.

```bash
npm run auth:codex
```

인증이 완료되면 토큰이 `./data/job-search.db` 에 저장되고, 실행 중인 컨테이너가 바로 그 값을 사용합니다.

자주 쓰는 명령:

```bash
npm run docker:build
npm run docker:up
npm run docker:down
npm run docker:logs
```

Compose 구성:

- 소스 코드는 bind mount로 반영됩니다.
- `node_modules`, `.next` 는 Docker volume으로 분리됩니다.
- SQLite DB와 업로드 파일은 각각 호스트의 `./data`, `./public/uploads` 를 bind mount 합니다.
- OpenAI Codex OAuth는 컨테이너가 아니라 호스트에서 처리하고, 컨테이너는 공유된 DB의 토큰만 읽습니다.

### 4. 사용 순서

1. **설정** — API 키 입력
   - Gemini / OpenAI API Key 입력 또는 OpenAI Codex 연결
2. **이력서** — PDF/TXT/MD 업로드
3. **채용 검색** — 키워드 입력 → 통합 검색 → 적합도 분석 → 맞춤 이력서 생성

## Project Structure

```
Dockerfile
docker-compose.yml
src/
├── app/
│   ├── search/          # 채용 검색 (메인)
│   ├── resume/          # 이력서 도구
│   ├── assistant/       # AI 어시스턴트
│   ├── settings/        # API 키 설정
│   └── api/
│       ├── auth/        # OpenAI Codex OAuth 시작/콜백/해제
│       ├── search/      # 통합 검색 + 분석 API
│       ├── resume/      # 업로드, 매칭, 수정, 추천
│       ├── ai/          # 자기소개서, 면접, 분석
│       └── settings/    # API 키 CRUD
├── lib/
│   ├── ai.ts            # 통합 AI 클라이언트 (Gemini/OpenAI API/OpenAI Codex)
│   ├── openai-codex.ts  # OpenAI Codex OAuth + bearer 요청 유틸
│   ├── settings.ts      # 설정 저장 유틸
│   ├── db.ts            # SQLite 연결
│   ├── i18n.ts          # 한국어/영어 번역
│   └── pdf-download.ts  # PDF 생성 (한글 지원)
└── components/
    ├── layout/          # 사이드바, 헤더, 테마, 언어
    └── ui/              # shadcn/ui 컴포넌트
```

## Data Storage

모든 데이터는 로컬에 저장되며 외부로 전송되지 않습니다.

| 항목 | 위치 |
|------|------|
| 데이터베이스 | `data/job-search.db` |
| 업로드 파일 | `public/uploads/` |
| API 키 | DB `settings` 테이블 |
| OpenAI Codex OAuth 토큰 | DB `settings` 테이블 (`access`, `refresh`, `expires_at`, `account_id`) |
| 검색 캐시 | 브라우저 sessionStorage |

`/api/settings`는 OpenAI Codex의 원문 access/refresh token을 반환하지 않고, 연결 여부/계정 힌트/만료 시각만 노출합니다.

## OpenAI Codex Notes

- `OpenAI Codex`는 실험적 provider 입니다.
- 기본 모델은 `gpt-5.4-mini`입니다.
- `auto` 모드의 우선순위는 `OpenAI Codex -> Gemini -> OpenAI API` 입니다.
- OAuth 연결이 끊기거나 refresh가 실패하면 **설정 > OpenAI Codex**에서 다시 연결해야 합니다.
- 기본 OAuth 콜백은 `http://localhost:1455/auth/callback` 입니다.
- Docker Compose는 `OPENAI_CODEX_AUTH_MODE=local-host` 로 실행되며, OAuth는 호스트에서 `npm run auth:codex` 로 처리합니다.
- 호스트 인증 스크립트와 컨테이너는 같은 `data/job-search.db` 를 공유합니다.
- 로컬 머신에서 Codex CLI나 다른 프로세스가 포트 `1455`를 사용 중이면 인증이 실패할 수 있습니다.
- `auto` 모드에서만 `OpenAI API`로 폴백하며, `OpenAI Codex`를 명시 선택하면 실패 시 닫힌 상태로 에러를 반환합니다.

## License

MIT
