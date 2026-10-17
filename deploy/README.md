# 배포

크랩크래프트는 Google Cloud VM 한 대(`crabcraft-1`, 프로젝트 `crabcraft-seonn`, `asia-northeast3-a`, 고정 IP `34.47.79.56`)에서 돈다. Vercel 과 Cloudflare 는 더 이상 쓰지 않는다. 크랩크래프트를 위해 `vercel` 이나 `wrangler` 를 실행하는 사람은 없어야 한다.

| 주소 | 브랜치 | 서버 포트 |
|---|---|---|
| https://crabcraft-dev.seonn.dev | `dev` | 8081 |
| https://crabcraft.seonn.dev | `main` | 8080 |

두 주소 모두 같은 출처에서 게임 파일, WebSocket `/multiplayer`, 계정 API `/api/account/*`, 영상 `/media/*` 를 내보낸다. 앞단은 Caddy 이고, Caddy 가 Let's Encrypt 인증서를 직접 받는다. 가비아 A 레코드가 `34.47.79.56` 을 가리켜야 인증서가 나온다. Let's Encrypt 는 주소마다 한 시간에 실패 5번까지만 받아 주므로 DNS 가 없을 때 Caddy 를 여러 번 reload 하지 않는다. `dig +short crabcraft-dev.seonn.dev` 가 IP 를 돌려준 뒤 15분이 지나도 https 가 안 열리면 `sudo systemctl reload caddy` 를 한 번 실행한다.

## 릴리스가 VM 에 닿는 길

1. `dev` 나 `main` 에 PR 이 merge 되면 GitHub Actions 의 `Deploy` 워크플로(`.github/workflows/deploy.yml`)가 돈다. Actions 탭에서 `Run workflow` 로 직접 돌릴 수도 있다.
2. 워크플로는 `pnpm install --frozen-lockfile`, `pnpm build`, (있으면) `pnpm build:server`, `pnpm test:multiplayer` 를 실행한다.
3. `dist/` 와 `server-dist/` 를 rsync 로 `deploy@34.47.79.56:/srv/crabcraft/<env>/releases/<커밋 sha>/` 에 올린다.
4. `sudo /srv/crabcraft/bin/activate.sh <env> <sha>` 가 `current` 링크를 새 릴리스로 바꾸고, 서버가 들어 있으면 `crabcraft-server@<env>` 를 다시 띄워 `/healthz` 를 기다린다. 응답이 없으면 바로 앞 릴리스로 되돌리고 워크플로는 실패로 끝난다.
5. 마지막으로 공개 주소에서 첫 화면과 COOP/COEP 헤더를 확인한다.

릴리스는 env 마다 최근 5개를 남긴다. 워크플로가 쓰는 비밀값은 `VM_SSH_KEY`, `VM_HOST`, `VM_KNOWN_HOSTS` 세 개다. `deploy` 사용자의 SSH 키는 릴리스 업로드와 `activate.sh` 실행만 할 수 있다.

## 되돌리기

VM 에 접속해 `rollback.sh` 를 실행한다. 인자를 하나만 주면 바로 앞 릴리스로 돌아가고, 다시 실행하면 원래 릴리스로 돌아온다. 특정 커밋으로 돌리려면 sha 를 함께 준다.

```bash
gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn
sudo /srv/crabcraft/bin/rollback.sh dev            # 바로 앞 릴리스로
sudo /srv/crabcraft/bin/rollback.sh prod <sha>     # 남아 있는 특정 릴리스로
ls -l /srv/crabcraft/prod/releases                 # 남아 있는 릴리스 목록
cat /srv/crabcraft/prod/history                    # 활성화 기록
```

코드로 되돌릴 때는 되돌리는 커밋을 PR 로 merge 하면 같은 길로 배포된다.

## 설정 파일과 비밀값

- 서버 환경 변수는 `/etc/crabcraft/dev.env`, `/etc/crabcraft/prod.env` 에 있다(`root:crabcraft`, 0640). `PORT`, `HOST`, `DATABASE_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY` 가 들어 있다. DB 비밀번호는 이 파일에만 있고 레포에는 없다. 값을 바꾸면 `sudo systemctl restart crabcraft-server@<env>` 로 반영한다.
- PostgreSQL 16 에 DB 와 역할이 `crabcraft_dev`, `crabcraft_prod` 로 하나씩 있다. 서로의 DB 에는 접속할 수 없다.
- Caddy 설정은 `/etc/caddy/Caddyfile`, 서버 유닛은 `crabcraft-server@.service` 다.
- 영상은 버킷 `gs://crabcraft-seonn-media/media/` 에 올린다. VM 이 10분마다 `/srv/crabcraft/media/` 로 받아 와(`crabcraft-media-sync.timer`) `/media/` 로 내보낸다. 버킷은 공개할 수 없어서 이렇게 한다.

## VM 설정 바꾸기

`deploy/vm/` 의 파일(Caddyfile, 유닛, 스크립트)은 워크플로가 올리지 않는다. 바꿨으면 merge 한 뒤 VM 에서 `setup.sh` 를 다시 실행한다. 여러 번 실행해도 같은 결과가 나오고, 기존 DB 비밀번호와 env 파일 값은 그대로 둔다.

```bash
gcloud compute scp --recurse deploy/vm crabcraft-1:/tmp/ --zone asia-northeast3-a --project crabcraft-seonn
gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn --command 'sudo bash /tmp/vm/setup.sh'
```

상태 확인은 `systemctl status caddy postgresql crabcraft-server@dev crabcraft-media-sync.timer`, 로그는 `journalctl -u crabcraft-server@dev -f` 로 본다.
