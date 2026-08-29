# 다시값 운영 배포 가이드

## 운영 배포 원칙

다시값 운영 배포는 **main의 정확한 Git commit SHA에 대응하는 immutable Docker image**만 사용합니다. 배포와 rollback 모두 `latest`를 운영 선택 기준으로 사용하지 않습니다.

- `ghcr.io/bloombouquet/dasigap:sha-<40-char-git-sha>`: 운영 애플리케이션 이미지
- `ghcr.io/bloombouquet/dasigap:migrate-sha-<40-char-git-sha>`: 동일 커밋의 Prisma migration 이미지
- `ghcr.io/bloombouquet/dasigap:latest`: main 최신 이미지 확인용 편의 tag이며 운영 배포/rollback 선택에는 사용하지 않음

`Production Image` workflow는 runtime image build 시 `RELEASE_SHA=<git-sha>`를 넘기고, Docker runtime에는 `DASIGAP_RELEASE_SHA=<git-sha>`로 주입합니다. 따라서 health endpoint가 응답하는 release identity와 배포 대상 commit을 정확히 비교할 수 있습니다.

## 서버 최초 준비

운영 서버에는 아래 항목이 준비되어 있어야 합니다.

- Linux
- Docker Engine
- Docker Compose plugin (`docker compose`)
- 배포 사용자의 Docker 실행 권한
- 배포 사용자가 사용할 수 있는 `/opt/dasigap/deploy`, `/opt/dasigap/state`
- 배포 사용자가 읽을 수 있는 `/etc/dasigap/dasigap.env`
- 접근 가능한 PostgreSQL
- 접근 가능한 S3-compatible private object storage
- Nginx 등 HTTPS reverse proxy / TLS termination
- BloomBouquet 공통 로그인 서비스 및 Dasigap OAuth client 등록

production container의 3000 포트는 인터넷에 직접 공개하지 않습니다. `deploy/compose.production.yml`은 `127.0.0.1:3000:3000`으로 loopback에만 바인딩합니다.

배포 후보는 별도 컨테이너 `dasigap-candidate`로 실행되며 기본적으로 `127.0.0.1:3101`에만 바인딩합니다. 후보 검증이 끝나면 항상 candidate container를 제거합니다.

운영 도메인은 저장소에 하드코딩하지 않습니다. `deploy/nginx.conf.example`의 예시 도메인과 인증서 경로를 실제 운영 값으로 교체해 사용합니다.

## 서버 환경 변수

`deploy/.env.production.example`을 참고해 `/etc/dasigap/dasigap.env`에 실제 값을 저장합니다. 실제 `.env`와 credential은 저장소에 커밋하지 않습니다.

주요 값은 다음과 같습니다.

```env
DATABASE_URL=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_REGION=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS=300

AUTH_MODE=bouquet
BOUQUET_AUTH_BASE_URL=https://bloombouquet.https.gsmsv.site
BOUQUET_AUTH_CLIENT_ID=
BOUQUET_AUTH_REDIRECT_URI=
BOUQUET_SESSION_TTL_SECONDS=604800

VALIDATION_ADMIN_USER_IDS=
```

다시값은 PKCE public client이므로 BloomBouquet OAuth client secret을 저장하지 않습니다.

`DASIGAP_RELEASE_SHA`는 운영자가 `.env`에 수동 지정하는 값이 아니라 immutable runtime image build에서 주입되는 release identity입니다.

## Health endpoint

### `/api/health/live`

프로세스 liveness와 release identity만 확인합니다. DB/S3에 접근하지 않습니다.

정상 응답 예시:

```json
{
  "status": "ok",
  "service": "dasigap",
  "release": "0123456789abcdef0123456789abcdef01234567"
}
```

### `/api/health/ready`

실제 트래픽을 받을 준비가 되었는지 확인합니다.

- PostgreSQL `SELECT 1`
- S3-compatible object storage bucket에 대한 인증된 non-mutating `HEAD`
- release identity

모든 의존성이 준비되면 HTTP 200과 `status: "ready"`, 하나라도 실패하면 HTTP 503과 `status: "not_ready"`를 반환합니다. 응답에는 내부 DB/S3 오류나 credential 같은 민감한 상세 내용을 노출하지 않습니다.

### `/api/health`

기존 호환성을 위한 legacy endpoint입니다. 신규 production deploy/rollback 검증은 `/api/health/live`와 `/api/health/ready`를 사용합니다.

## Production Image workflow

`.github/workflows/production-image.yml`은 branch/main에서 production Docker 구조를 검증합니다.

핵심 gate는 다음과 같습니다.

1. runtime image에 exact Git SHA를 `RELEASE_SHA` build arg로 주입합니다.
2. runtime image를 실행하고 `/api/health/live`의 `release`가 exact SHA와 일치하는지 확인합니다.
3. migrator image를 PostgreSQL에 연결해 migration smoke를 수행합니다.
4. main일 때만 immutable GHCR runtime/migrator tag를 게시합니다.

branch에서 image smoke가 성공하더라도 실제 운영 서버, TLS, 운영 PostgreSQL/S3, BloomBouquet OAuth 설정까지 검증되었다는 의미는 아닙니다.

## 운영 배포 순서

서버 배포 도구는 `/opt/dasigap/deploy`에 위치합니다.

```bash
cd /opt/dasigap
./deploy/deploy.sh sha-<40-character-git-sha>
```

`deploy.sh`는 다음 순서를 보장합니다.

1. 입력 tag가 `sha-<40 lowercase hex>`인지 검증합니다.
2. Docker/Compose 및 `/etc/dasigap/dasigap.env`를 확인합니다.
3. 현재 production container가 유효한 immutable Dasigap image인지 읽습니다.
4. 동일 SHA의 migrator image와 runtime image를 pull 합니다.
5. **새 앱으로 production을 건드리기 전에** migrator image로 `prisma migrate deploy`를 실행합니다.
6. migration 성공 후 runtime image를 `dasigap-candidate`로 `127.0.0.1:3101`에 기동합니다.
7. candidate 내부에서 `/api/health/live`와 `/api/health/ready`를 모두 확인하고 두 endpoint의 `release`가 대상 SHA와 정확히 일치하는지 확인합니다.
8. candidate가 통과한 경우에만 현재 immutable production image를 `previous-image` 상태에 기록합니다.
9. Docker Compose로 production container를 새 immutable image로 교체합니다.
10. production container 내부에서 live + ready + exact SHA를 다시 검증합니다.
11. local post-switch 검증이 실패하면 이전 immutable application image를 자동 복원합니다.

migration/pull/candidate 단계가 실패하면 현재 production application은 교체하지 않습니다.

### 첫 배포 실패

기존 production image가 없는 첫 배포에서는 가짜 또는 stale rollback target을 만들지 않습니다. 새 production container가 local 검증에 실패하면 실패한 container를 제거/중단하고 workflow를 실패시킵니다.

## GitHub Actions 수동 배포

`.github/workflows/deploy-production.yml`의 `Deploy Production` workflow는 `main`에서만 `workflow_dispatch`로 실행합니다.

입력값:

- `image_sha`: 배포할 **40자리 lowercase main commit SHA**

`production` GitHub Environment에 다음 값을 설정합니다.

### Secrets

- `DEPLOY_HOST`: 운영 SSH host
- `DEPLOY_USER`: 운영 배포 사용자
- `DEPLOY_SSH_KEY`: 배포 전용 private SSH key
- `DEPLOY_KNOWN_HOSTS`: 별도 신뢰 경로에서 확인한 운영 서버 known_hosts line

### Variable

- `PRODUCTION_BASE_URL`: 실제 운영 HTTPS origin. 예: `https://example.com`

`PRODUCTION_BASE_URL`은 HTTPS URL이어야 하며 embedded credential이나 fragment를 허용하지 않습니다.

workflow는 `ssh-keyscan`이나 `StrictHostKeyChecking=no`를 사용하지 않습니다. `DEPLOY_KNOWN_HOSTS`와 `StrictHostKeyChecking=yes`로 host key를 고정합니다.

배포 workflow와 rollback workflow는 모두 같은 concurrency group `dasigap-production-deploy`를 사용하고 `cancel-in-progress: false`이므로 운영 변경이 서로 겹쳐 실행되지 않습니다.

workflow 순서:

1. input SHA 형식 및 main ancestry 검증
2. pinned SSH 설정
3. compose/release-common/deploy/rollback script를 `/opt/dasigap/deploy`에 staging
4. GitHub 단기 token으로 GHCR login
5. 서버에서 `./deploy/deploy.sh sha-$IMAGE_SHA`
6. 서버 local 검증 성공 후 `${PRODUCTION_BASE_URL}/api/health/ready`를 외부 HTTPS로 호출
7. 외부 응답이 `status=ready`이고 `release=$IMAGE_SHA`인지 검증
8. 외부 검증 실패 시 `./deploy/rollback.sh --restore-previous-or-stop`을 호출해 이전 앱 복원을 시도하고 workflow는 **반드시 실패**
9. 작업 종료 시 GHCR logout best-effort 실행

외부 검증 실패 후 자동 복원이 성공하더라도 원래 deploy workflow를 성공으로 바꾸지 않습니다.

## Rollback

rollback은 **애플리케이션 image만** 되돌립니다. DB schema를 역마이그레이션하지 않습니다.

기본적으로 직전 배포 전 image는 `/opt/dasigap/state/previous-image`에 저장됩니다.

```bash
cd /opt/dasigap
./deploy/rollback.sh
```

특정 immutable main SHA를 지정할 수도 있습니다.

```bash
./deploy/rollback.sh sha-<40-character-git-sha>
```

rollback 순서:

1. target이 immutable Dasigap `sha-<40>` image인지 검증
2. 현재 production image를 복구 대상으로 기억
3. target image pull
4. **production 교체 전에** target을 loopback candidate로 기동
5. candidate live + ready + exact SHA 검증
6. 통과한 경우에만 production을 target image로 교체
7. local post-switch live + ready + exact SHA 검증
8. 실패 시 rollback 시작 당시 실행 중이던 application image를 다시 복원

rollback script에는 Prisma migration 실행 경로가 없습니다.

### GitHub Actions rollback

`.github/workflows/rollback-production.yml`의 `Rollback Production` workflow를 사용합니다.

- main에서만 실행
- full 40-char `image_sha` 입력
- 대상 SHA가 main ancestry인지 검증
- deploy와 동일한 production environment/pinned SSH/concurrency 사용
- server candidate 검증 후 application rollback
- 외부 `/api/health/ready`에서 exact target SHA 검증
- 외부 실패 시 rollback 직전 application을 다시 복구 시도하고 workflow 실패

## DB migration 호환성 원칙

배포는 migration을 먼저 수행하고, rollback은 DB를 downgrade하지 않습니다. 따라서 migration은 **새 앱과 즉시 이전 앱이 모두 동작할 수 있는 방향**으로 작성해야 합니다.

운영 원칙은 expand/contract입니다.

1. 새 nullable column/table/index 등 backward-compatible schema를 먼저 추가
2. 새 코드가 새 schema를 사용하도록 배포
3. 데이터 backfill/전환
4. 이전 앱이 더 이상 필요하지 않은 것이 확인된 뒤 별도 변경으로 destructive contract 수행

column 삭제/rename, type narrowing, 즉시 NOT NULL 강제처럼 이전 application을 깨뜨릴 수 있는 migration은 일반 배포에 섞지 않고 별도 운영 계획과 복구 전략을 세웁니다.

## HTTPS reverse proxy

`deploy/nginx.conf.example`은 HTTP를 HTTPS로 redirect하고 HTTPS 요청을 `http://127.0.0.1:3000`으로 전달합니다. 업로드는 앱의 10 MiB 제한보다 약간 큰 `client_max_body_size 11m`을 사용해 proxy 계층에서 정상 요청이 잘리지 않도록 합니다.

## BloomBouquet 최초 등록

1. 실제 HTTPS 도메인으로 다시값 container를 노출합니다.
2. BloomBouquet 등록에서 `teamId=rose`, `requiresAuth=true`, `authRedirectUri=<production-origin>/auth/bouquet/callback`을 사용합니다.
3. 발급된 OAuth client ID를 `BOUQUET_AUTH_CLIENT_ID`에 설정합니다.
4. `BOUQUET_AUTH_REDIRECT_URI`를 등록 callback URI와 정확히 동일하게 설정합니다.
5. `AUTH_MODE=bouquet`인지 확인합니다.
6. 실제 브라우저에서 authorize → callback → Dasigap session → 보호 API → logout smoke를 수행합니다.

## 배포 전 체크리스트

- 대상 SHA가 main에 포함되어 있음
- 해당 SHA의 Production Image workflow가 성공함
- runtime `sha-<SHA>`와 migrator `migrate-sha-<SHA>`가 준비됨
- `/etc/dasigap/dasigap.env`에 실제 PostgreSQL/S3/BloomBouquet 설정이 있음
- `production` environment의 SSH secrets가 설정됨
- `PRODUCTION_BASE_URL`이 실제 HTTPS origin으로 설정됨
- Nginx/TLS가 `127.0.0.1:3000`으로 정상 proxy함
- DB migration이 즉시 이전 앱과 backward compatible함

## 자동화가 증명하지 않는 것

CI, Production Image smoke, deploy/rollback state-machine 테스트가 모두 성공해도 다음 실제 운영 요소는 별도 확인이 필요합니다.

- 실제 운영 서버 SSH 접근/권한
- 실제 Nginx/TLS 인증서와 DNS
- 운영 PostgreSQL 네트워크/credential
- 운영 S3-compatible storage 네트워크/credential/policy
- BloomBouquet 실제 client ID와 callback allowlist
- 실제 브라우저 OAuth/session 흐름

따라서 merge 가능 상태와 실제 production rollout 완료 상태를 동일하게 취급하지 않습니다.
