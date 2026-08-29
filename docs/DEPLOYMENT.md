# 다시값 운영 배포 가이드

## 배포 산출물

`main`에 반영된 커밋은 `Production Image` GitHub Actions workflow에서 검증된 애플리케이션 이미지와 Prisma migration 이미지를 GHCR에 게시합니다.

- `ghcr.io/bloombouquet/dasigap:sha-<git-sha>`: 운영 애플리케이션 immutable tag
- `ghcr.io/bloombouquet/dasigap:migrate-sha-<git-sha>`: 동일 커밋의 Prisma migration immutable tag
- `ghcr.io/bloombouquet/dasigap:latest`: 최신 main 확인용 편의 tag

운영 배포와 rollback에는 항상 `sha-<git-sha>` 형식의 immutable tag만 사용합니다.

## 서버 최초 준비

서버에는 아래 항목이 먼저 준비되어 있어야 합니다.

- Linux
- Docker Engine
- Docker Compose plugin (`docker compose`)
- 배포 사용자의 Docker 실행 권한
- 배포 사용자가 쓸 수 있는 `/opt/dasigap` 디렉터리
- 배포 사용자가 읽을 수 있는 `/etc/dasigap/dasigap.env`
- PostgreSQL
- S3-compatible private object storage
- Nginx 등 HTTPS reverse proxy / TLS termination
- BloomBouquet 공통 로그인 서비스

애플리케이션의 3000 포트는 인터넷에 직접 공개하지 않습니다. `deploy/compose.production.yml`은 `127.0.0.1:3000`에만 바인딩합니다.

운영 도메인은 저장소에 하드코딩하지 않습니다. `deploy/nginx.conf.example`의 예시 도메인과 인증서 경로를 실제 도메인으로 교체해 사용합니다.

## 환경 변수

`deploy/.env.production.example`을 참고해 서버의 `/etc/dasigap/dasigap.env`에 실제 값을 넣습니다. 이 파일은 저장소에 커밋하지 않습니다.

```env
AUTH_MODE=bouquet
BOUQUET_AUTH_BASE_URL=https://bloombouquet.https.gsmsv.site
BOUQUET_AUTH_CLIENT_ID=<BloomBouquet registration result>
BOUQUET_AUTH_REDIRECT_URI=<DASIGAP_HTTPS_ORIGIN>/auth/bouquet/callback
```

다시값은 PKCE public client이므로 OAuth client secret을 저장하지 않습니다.

## 데이터베이스 migration

애플리케이션 시작과 migration은 분리합니다. `deploy/deploy.sh`는 새 앱을 교체하기 전에 같은 Git SHA로 게시된 migration 이미지를 실행합니다.

예를 들어 `sha-0123...`를 배포하면 먼저 아래 이미지가 실행됩니다.

```text
ghcr.io/bloombouquet/dasigap:migrate-sha-0123...
```

migration이 실패하면 새 애플리케이션 컨테이너로 교체하지 않습니다. migration 성공 후에만 `ghcr.io/bloombouquet/dasigap:sha-0123...`를 기동합니다.

## 서버에서 직접 배포

배포 도구는 `/opt/dasigap/deploy`에 둡니다.

```bash
cd /opt/dasigap
./deploy/deploy.sh sha-<40-character-git-sha>
```

`deploy.sh`는 다음 순서로 동작합니다.

1. immutable SHA 형식을 검증합니다.
2. 현재 실행 중인 immutable 앱 이미지를 `/opt/dasigap/state/previous-image`에 기록합니다.
3. migration 이미지와 앱 이미지를 pull 합니다.
4. migration 이미지를 `--network host`와 비공개 env file로 실행합니다.
5. migration 성공 시 Docker Compose로 앱 컨테이너를 교체합니다.
6. 컨테이너 내부에서 `/api/health`를 반복 확인합니다.
7. health가 실패하면 새 컨테이너를 중단하고 실패로 종료합니다. DB schema는 자동으로 되돌리지 않습니다.

## GitHub Actions에서 수동 배포

`.github/workflows/deploy-production.yml`의 `Deploy Production` workflow는 `main`에서만 `workflow_dispatch`로 실행합니다. 입력값은 배포할 40자리 main commit SHA입니다.

GitHub `production` environment 또는 repository secrets에 다음 값을 설정합니다.

- `DEPLOY_HOST`: 운영 SSH 호스트
- `DEPLOY_USER`: 운영 배포 사용자
- `DEPLOY_SSH_KEY`: 배포 전용 private SSH key
- `DEPLOY_KNOWN_HOSTS`: 별도 신뢰 경로로 확인한 운영 서버 host key 라인

workflow는 `ssh-keyscan`으로 서버 키를 자동 신뢰하지 않습니다. `DEPLOY_KNOWN_HOSTS`와 `StrictHostKeyChecking=yes`로 host key를 고정합니다.

배포 시 workflow는 compose/deploy/rollback 파일을 `/opt/dasigap/deploy`에 갱신하고, GitHub의 단기 토큰으로 GHCR에 로그인한 뒤 아래 명령을 서버에서 실행합니다.

```bash
cd /opt/dasigap
./deploy/deploy.sh sha-<git-sha>
```

작업 종료 시 서버의 GHCR 로그인 정보는 best-effort로 logout 합니다.

## HTTPS reverse proxy

`deploy/nginx.conf.example`은 HTTP를 HTTPS로 redirect하고 HTTPS 요청만 `http://127.0.0.1:3000`으로 전달합니다. 업로드는 앱의 10 MiB 제한보다 약간 큰 `client_max_body_size 11m`을 사용해 프록시 계층에서 정상 요청이 잘리지 않게 합니다.

## Health check

`GET /api/health`는 DB/S3 상태와 분리된 프로세스 liveness endpoint이며 정상 시 `{"status":"ok"}`를 반환합니다. Docker image와 Compose healthcheck 모두 같은 endpoint를 사용합니다.

## BloomBouquet 최초 등록 순서

1. 실제 HTTPS 도메인으로 다시값 컨테이너를 먼저 노출합니다.
2. BloomBouquet one-click 등록에서 `teamId=rose`, `requiresAuth=true`, `authRedirectUri=<demoUrl>/auth/bouquet/callback`을 사용합니다.
3. 등록 결과의 OAuth client ID를 `BOUQUET_AUTH_CLIENT_ID`에 넣습니다.
4. `BOUQUET_AUTH_REDIRECT_URI`를 등록된 callback URI와 정확히 동일하게 설정합니다.
5. 컨테이너를 재시작하고 실제 브라우저에서 꽃다발 로그인 → callback → 다시값 session 생성을 smoke test합니다.

## Rollback

가장 최근 배포 전 이미지는 기본적으로 `/opt/dasigap/state/previous-image`에서 읽습니다.

```bash
cd /opt/dasigap
./deploy/rollback.sh
```

특정 immutable 앱 SHA로 명시적 rollback도 가능합니다.

```bash
./deploy/rollback.sh sha-<40-character-git-sha>
```

rollback은 애플리케이션 이미지에만 적용됩니다. DB migration은 자동 downgrade하지 않으며, destructive migration은 별도 검토 없이 추가하지 않습니다. 이전 앱 버전이 이미 전진된 schema와 호환되는지 운영자가 확인해야 합니다.
