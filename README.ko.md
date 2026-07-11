# coupang-browser-mcp

[![npm](https://img.shields.io/npm/v/coupang-browser-mcp)](https://www.npmjs.com/package/coupang-browser-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![personal use](https://img.shields.io/badge/scope-personal--use-orange)](#%EF%B8%8F-먼저-읽어주세요)

[English](./README.md) · **한국어**

**본인 크롬 브라우저**(CDP)로 쿠팡을 검색하는 **개인용** MCP 서버입니다. API 키도, 파트너스 계정도 필요 없습니다. 공식 API가 주지 못하는 평점·리뷰 본문·내 주문·장바구니까지 다룹니다.

## ⚠️ 먼저 읽어주세요

- **서비스가 아니라 개인용 도구입니다.** *본인이* 실행한 크롬을, *본인* 계정으로, *본인* IP에서 원격 조종할 뿐입니다. 아무것도 호스팅·수집·재배포하지 않습니다.
- **봇 차단을 우회하지 않습니다** — 사용자가 소유한 진짜 브라우저 세션을 그대로 사용합니다.
- 쿠팡 약관상 자동화 도구는 제한될 수 있으며, 사용 책임은 본인에게 있습니다. 대량·상업적 데이터 수집에 쓰지 마세요.
- 쿠팡 마크업이 바뀌면 추출이 깨질 수 있습니다 — `debug_page_structure` 도구로 진단하고 수정하세요.
- **결제는 절대 자동화하지 않습니다.** `proceed_to_checkout`은 주문서까지만 열고 멈추며, 마지막 결제 클릭은 항상 사람의 몫입니다.
- 비공식 프로젝트이며 쿠팡과 무관합니다.

## 빠른 시작

**1. 디버깅 포트를 열고 크롬 실행** (기존 크롬을 완전히 종료한 뒤):

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

주문·장바구니 도구를 쓰려면 그 크롬에서 coupang.com에 로그인해두세요.

> **브라우저 창이 뜨는 게 싫다면?** (macOS) 1단계 대신 동봉된 래퍼를 쓰세요. 별도 프로필의 *전용* 크롬(포트 9223)을 띄우고 창을 숨긴 뒤 계속 숨김 상태로 유지합니다. MCP 클라이언트가 `npx coupang-browser-mcp` 대신 `run-mcp-hidden.sh`를 실행하도록 등록하면 됩니다:
>
> ```bash
> claude mcp add coupang-browser -- \
>   "$(npm root -g)/coupang-browser-mcp/scripts/run-mcp-hidden.sh"
> ```
>
> 헤드리스 크롬은 쓰지 **않습니다**: 쿠팡이 헤드리스에 "Access Denied"를 반환하는데, 이 프로젝트는 봇 감지를 우회하지 않기 때문입니다. 창은 진짜 창이고, 숨겨져 있을 뿐입니다. 로그인이나 결제를 위해 창이 필요하면 `scripts/show-chrome.sh`를 실행하세요 (`rm ~/.coupang-chrome/keep-visible`로 다시 숨김).

**2. MCP 클라이언트에 서버 등록:**

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add coupang-browser -- npx -y coupang-browser-mcp
```
</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json`에 추가 (설정 → Developer → Edit Config):

```json
{
  "mcpServers": {
    "coupang-browser": { "command": "npx", "args": ["-y", "coupang-browser-mcp"] }
  }
}
```
</details>

<details>
<summary><b>Codex CLI</b></summary>

`~/.codex/config.toml`에 추가:

```toml
[mcp_servers.coupang-browser]
command = "npx"
args = ["-y", "coupang-browser-mcp"]
```
</details>

<details>
<summary><b>OpenCode</b></summary>

`opencode.json`(프로젝트) 또는 `~/.config/opencode/opencode.json`(전역)에 추가:

```json
{
  "mcp": {
    "coupang-browser": {
      "type": "local",
      "command": ["npx", "-y", "coupang-browser-mcp"],
      "enabled": true
    }
  }
}
```
</details>

<details>
<summary><b>Cursor</b></summary>

`.cursor/mcp.json`(프로젝트) 또는 `~/.cursor/mcp.json`(전역)에 추가하거나, Settings → MCP → Add new global MCP server 사용:

```json
{
  "mcpServers": {
    "coupang-browser": { "command": "npx", "args": ["-y", "coupang-browser-mcp"] }
  }
}
```
</details>

## 아키텍처

```
┌─────────────────┐  stdio (JSON-RPC)  ┌──────────────────────┐
│   MCP 클라이언트 │◄──────────────────►│  coupang-browser-mcp │
│  (Claude Code,  │                    │                      │
│   Cursor, ...)  │                    │  index.ts   도구 9개  │
└─────────────────┘                    │  throttle.ts 5초 간격 │
                                       │  extract.ts  파서     │
                                       └──────────┬───────────┘
                                                  │ CDP (playwright-core)
                                                  │ localhost:9222
                                                  ▼
                                       ┌──────────────────────┐
                                       │   본인의 크롬         │
                                       │  (내 세션, 내 로그인, │
                                       │   내 IP)             │
                                       └──────────┬───────────┘
                                                  │ 실제 브라우저 트래픽
                                                  ▼
                                       ┌──────────────────────┐
                                       │     coupang.com      │
                                       │  검색 / 상품 / 리뷰   │
                                       │   / 주문 / 장바구니   │
                                       └──────────────────────┘

도구 호출마다:  공용 탭 이동 → 추출 (내장 JSON ▸ DOM 폴백) → about:blank로 초기화
호출은 탭 하나를 공유하며 직렬로 처리됩니다. 새 탭을 열면 macOS가 크롬 숨김을
자동 해제해서, 호출할 때마다 창이 튀어나오기 때문입니다.
```

## 예시 프롬프트

| 이렇게 말하면 | 실행되는 도구 |
|---|---|
| "쿠팡에서 에어팟 검색해줘" | `search_products` |
| "이 상품 평점이랑 리뷰 수 알려줘" | `get_product_detail` |
| "이 상품 리뷰 좀 읽어줘" | `get_product_reviews` |
| "내 주문 배송 어디까지 왔어?" | `get_my_orders` |
| "장바구니에 뭐 들어있지?" | `get_cart` |
| "이거 장바구니에 담아줘" | `add_to_cart` (미리보기 → 확인) |
| "주문할게, 결제 페이지 열어줘" | `proceed_to_checkout` (결제 직전에서 멈춤) |

## 도구

| 도구 | 파라미터 | 설명 |
|---|---|---|
| `search_products` | `keyword`\*, `limit` (≤36), `rocketOnly`, `sortBy` | 검색 페이지에서 상품 추출 (내장 JSON 우선, DOM 폴백) |
| `get_product_detail` | `url`\* | 상품 페이지의 가격·평점·리뷰 수 — 공식 API가 주지 못하는 데이터 |
| `get_product_reviews` | `url`\*, `limit` (≤10), `maxTextLength` | 개별 리뷰(작성자, 날짜, 별점, 구매 옵션, 본문) — 지연 로딩되는 리뷰 영역까지 스크롤해서 가져옵니다 |
| `debug_page_structure` | `url`\* | 페이지에 내장된 JSON 뭉치의 뼈대 — 마크업이 바뀌었을 때 자가 진단용 |
| `get_my_orders` | — | 주문 내역 + 배송 상태 (읽기 전용, 로그인 필요) |
| `get_cart` | — | 장바구니 내용 (읽기 전용, 로그인 필요) |
| `add_to_cart` | `url`\*, `quantity`, `confirm` | **2단계**: 먼저 미리보기, `confirm=true`일 때만 실행 |
| `remove_from_cart` | `productName`\*, `confirm` | 2단계; 정확히 하나만 매칭될 때만 삭제 |
| `proceed_to_checkout` | `confirm` | 2단계; `confirm=true`일 때 주문서를 열고 **멈춤** — 장바구니 페이지에서만 클릭하고, 결제 버튼은 절대 누르지 않으며, 탭은 열어둠 |

## 안전 모델

1. **읽기는 자유롭게, 쓰기는 확인 후.** 장바구니 변경 *및 주문서 열기*는 미리보기를 반환하고, 두 번째 호출에서 `confirm=true`가 있어야 실행됩니다.
2. **돈은 저절로 움직이지 않습니다 — 약속이 아니라 코드로 강제합니다.** `openCheckout()`은 URL이 `cart.coupang.com`일 때만 클릭하고, 라벨이 결제처럼 읽히는 버튼(`결제`, `바로구매`, `pay`)은 거부하며, 주문서가 열린 뒤에는 페이지를 일절 건드리지 않습니다. 결제 버튼을 누르는 코드 경로는 존재하지 않습니다.
3. **자율적인 속도 제한**: 페이지 로드 간 5초 이상, 시간당 60회 이하 (설정 가능). 계약상 제한이 없는 영역이라 스스로 제한을 겁니다.

## 설정

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `COUPANG_CDP_URL` | `http://localhost:9222` | 크롬 DevTools 엔드포인트 |
| `COUPANG_MIN_GAP_MS` | `5000` | 페이지 로드 사이 최소 간격 |
| `COUPANG_HOURLY_CEILING` | `60` | 시간당 최대 페이지 로드 수 |

## 문제 해결

| 증상 | 해결 |
|---|---|
| "Chrome CDP에 연결할 수 없습니다" | 크롬이 `--remote-debugging-port=9222` 없이 실행 중이거나, 디버그가 아닌 기존 크롬이 프로필을 잡고 있습니다 — 크롬을 완전히 종료하고 플래그와 함께 다시 실행하세요 |
| `Browser context management is not supported` | 오래된 디버그 인스턴스가 남아 있습니다 — 종료 후 크롬을 새로 실행하세요 |
| 결과가 비어 있음 / "추출 실패" | 쿠팡 마크업이 바뀐 것입니다 — 같은 URL로 `debug_page_structure`를 실행하고 그 출력과 함께 이슈를 남겨주세요 |
| "쿠팡 로그인이 필요합니다" | 디버그 크롬에서 coupang.com에 로그인하세요 (주문·장바구니 도구에만 해당) |
| 호출할 때마다 크롬 창이 뜸 | 구버전입니다 — 0.2.1 이하는 호출마다 새 탭을 열었습니다. 업그레이드하고, 창을 완전히 숨기려면 `run-mcp-hidden.sh`를 사용하세요 |

## 개발

```bash
npm install
npm run lint                      # eslint (타입 체크 포함)
npm test                          # 추출 로직 단위 테스트 (브라우저 불필요)
npm run build                     # tsc → dist/
npx tsx scripts/tool-output.ts    # 실제 호출 점검 → test-output/*.txt (크롬이 떠 있으면 사용)
```

## 라이선스

[MIT](./LICENSE)
