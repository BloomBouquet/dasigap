# 다시값 운영 배포 가이드

## 배포 산출물

`main`에 반영된 커밋은 `Production Image` GitHub Actions workflow에서 production Docker image를 검증하고 GHCR에 게시합니다.

- `ghcr.io/bloombouquet/dasigap:sha-<git-sha>`: 배포 고정용 immutable tag
- `ghcr.io/bloombouquet/dasigap:latest`: 최신 main 편의 tag

운영에서는 rollback을 위해 `sha-<git-sha>` 태그를 사용합니다.

## 필수 인프라

- PostgreSQL
- S3-compatible private object storage
- HTTPS reverse proxy / TLS termination
- BloomBouquet 공통 로그인 서비스

운영 도메인은 저장소에 하드코딩하지 않습니다.

## 환경 변수

`deploy/.env.production.example`을 서버의 비공개 환경 파일로 복사한 뒤 실제 값을 채웁니다.

```env
AUTH_MODE=bouquet
BOUQUET_AUTH_BASE_URL=https://bloombouquet.https.gsmsv.site
BOUQUET_AUTH_CLIENT_ID=<BloomBouquet registration result>
BOUQUET_AUTH_REDIRECT_URI=<DASIGAP_HTTPS_ORIGIN>/auth/bouquet/callback
```

다시값은 PKCE public client이므로 OAuth client secret을 저장하지 않습니다.

## 데이터베이스 migration

애플리케이션 컨테이너 시작과 migration을 결합하지 않습니다. release 교체 전에 저장소 checkout 환경에서 실행합니다.

```bash
set -a
. /etc/dasigap/dasigap.env
set +a
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
pnpm db:deploy
```

migration 성공 후 새 image로 애플리케이션 컨테이너를 교체합니다.

## 컨테이너 실행

```bash
docker pull ghcr.io/bloombouquet/dasigap:sha-<git-sha>

docker run -d \
  --name dasigap \
  --restart unless-stopped \
  --env-file /etc/dasigap/dasigap.env \
  -p 127.0.0.1:3000:3000 \
  ghcr.io/bloombouquet/dasigap:sha-<git-sha>
```

3000 포트는 인터넷에 직접 공개하지 않고 HTTPS reverse proxy를 통해서만 노출합니다.

## Health check

`GET /api/health`는 DB/S3 상태와 분리된 프로세스 liveness endpoint이며 정상 시 `{"status":"ok"}`를 반환합니다. Docker image의 `HEALTHCHECK`도 같은 endpoint를 사용합니다.

## BloomBouquet 최초 등록 순서

1. 실제 HTTPS 도메인으로 다시값 컨테이너를 먼저 노출합니다.
2. BloomBouquet one-click 등록에서 `teamId=rose`, `requiresAuth=true`, `authRedirectUri=<demoUrl>/auth/bouquet/callback`을 사용합니다.
3. 등록 결과의 OAuth client ID를 `BOUQUET_AUTH_CLIENT_ID`에 넣습니다.
4. `BOUQUET_AUTH_REDIRECT_URI`를 등록된 callback URI와 정확히 동일하게 설정합니다.
5. 컨테이너를 재시작하고 실제 브라우저에서 꽃다발 로그인 → callback → 다시값 session 생성을 smoke test합니다.

## Rollback

애플리케이션은 이전 `sha-<git-sha>` image로 교체합니다. DB migration은 자동 downgrade하지 않으며 destructive migration은 별도 검토 없이 추가하지 않습니다.
