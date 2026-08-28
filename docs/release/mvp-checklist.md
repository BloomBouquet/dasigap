# 다시값 MVP Release Checklist

- Candidate branch: `dasigap/review`
- Verified candidate head: `c24f0a7d6fe0fe0565459cb6720fe126be81ca60`
- Release evidence: GitHub Actions CI #190
- CI run: https://github.com/BloomBouquet/dasigap/actions/runs/33132289496
- Result: **PASS**

## Design acceptance criteria

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| 첫 물건 등록 플로우 정상 동작 | PASS | `pnpm test:e2e` → `tests/e2e/first-item.spec.ts` |
| 각 Item이 현재 로그인 사용자의 소유권으로 격리됨 | PASS | `pnpm test` → ownership/security integration suites; `pnpm test:e2e` → `release-acceptance.spec.ts` User B GET/PATCH 404 |
| 영수증이 public URL로 노출되지 않음 | PASS | `pnpm test:e2e` → `receipt-privacy.spec.ts`; owner-only short-lived signed access |
| 영수증 삭제가 object storage까지 반영됨 | PASS | `receipt-privacy.spec.ts`; real S3-compatible MinIO PUT → signed GET → DELETE → GET 404 integration |
| 보증/반품 계산 테스트 통과 | PASS | `pnpm test` → lifecycle unit/integration tests; `release-acceptance.spec.ts` lifecycle detail E2E |
| 판매 준비 플로우 정상 완료 | PASS | `pnpm test:e2e` → `resale-flow.spec.ts` |
| 판매용 결과에 개인정보가 자동 삽입되지 않음 | PASS | `pnpm test` → resale privacy/template tests; `resale-flow.spec.ts` |
| 외부 플랫폼 자동 로그인/자동 게시 코드가 존재하지 않음 | PASS | `pnpm test` → `tests/integration/forbidden-features.test.ts` production-source scan |
| 판매 완료 및 실질 사용비 계산 테스트 통과 | PASS | `pnpm test` → sale/report and usage-cost tests; `release-acceptance.spec.ts` COST 79,000원 / PROFIT 20,000원 E2E |
| 핵심 E2E 시나리오 통과 | PASS | `pnpm test:e2e` → 9/9 Playwright tests PASS in CI #190 |
| 개인정보처리방침/서비스 이용약관 링크 위치 확보 | PASS | `pnpm test:e2e` → `home-pwa-legal.spec.ts` |

## Additional release gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Frozen dependency installation | PASS | `pnpm install --frozen-lockfile` |
| Prisma schema and deployed migrations | PASS | `pnpm prisma validate` + `pnpm prisma migrate deploy` |
| TypeScript strict verification | PASS | `pnpm typecheck` |
| Unit / integration / security / forbidden-feature suite | PASS | 79 tests PASS; S3 integration intentionally skipped in the normal suite and executed separately against MinIO |
| Real S3-compatible signed URL semantics | PASS | MinIO server/client pinned in CI; `tests/integration/s3-storage.test.ts` 1/1 PASS |
| Production build | PASS | `pnpm build` |
| Full browser release suite | PASS | `pnpm test:e2e` → 9/9 PASS |

## Required E2E scenario coverage

1. PASS — first item registration
2. PASS — item detail lifecycle display
3. PASS — receipt upload and owner-only access
4. PASS — resale preparation and copy
5. PASS — sold record
6. PASS — report shows usage cost and sale profit correctly
7. PASS — user B cannot access user A resource
8. PASS — document deletion removes storage object

## Forbidden-feature review

Release remains blocked if production code adds any of the following without a separate approved scope and legal/technical review:

- marketplace password or credential storage
- automatic marketplace login, posting, or cross-posting
- Carrot/Bunjang scraping jobs
- internal buyer/seller chat, payment, or escrow

The current production-source scan reports **PASS** for all four categories.

## Final verification commands

```bash
pnpm install --frozen-lockfile
pnpm prisma validate
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

All required commands exited successfully in CI #190. The dedicated real S3-compatible signed-URL integration also passed before the build and E2E stages.

## Release decision

**PASS — 다시값 MVP satisfies the approved V1 release acceptance criteria represented by the current repository test and CI gates.**
