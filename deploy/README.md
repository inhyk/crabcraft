# 배포

크랩크래프트는 Google Cloud VM 한 대(`crabcraft-1`, 프로젝트 `crabcraft-seonn`, `asia-northeast3-a`, 고정 IP `34.47.79.56`)에서 돈다. Vercel 과 Cloudflare 는 더 이상 쓰지 않는다. 크랩크래프트를 위해 `vercel` 이나 `wrangler` 를 실행하는 사람은 없어야 한다.

| 주소 | 브랜치 | 서버 포트 |
|---|---|---|
| https://crab-dev.seonn.dev | `dev` | 8081 |
| https://crab.seonn.dev | `main` | 8080 |

두 주소 모두 같은 출처에서 게임 파일, WebSocket `/multiplayer`, 계정 API `/api/account/*`, 영상 `/media/*` 를 내보낸다. 앞단은 Caddy 이고, Caddy 가 Let's Encrypt 인증서를 직접 받고 갱신한다. 가비아의 A 레코드 `crab.seonn.dev`, `crab-dev.seonn.dev` 가 `34.47.79.56` 을 가리키고 있어야 한다. Let's Encrypt 는 주소마다 한 시간에 실패 5번까지만 받아 주므로, 인증서가 안 나올 때 Caddy 를 연달아 reload 하지 말고 `journalctl -u caddy` 로 원인부터 본다.

## 릴리스가 VM 에 닿는 길

1. `dev` 나 `main` 에 PR 이 merge 되면 GitHub Actions 의 `Deploy` 워크플로(`.github/workflows/deploy.yml`)가 돈다. Actions 탭에서 `Run workflow` 로 직접 돌릴 수도 있다.
2. 워크플로는 `pnpm install --frozen-lockfile`, `pnpm build`, (있으면) `pnpm build:server`, `pnpm test:multiplayer` 를 실행한다.
3. `dist/` 와 `server-dist/` 를 rsync 로 `deploy@34.47.79.56:/srv/crabcraft/<env>/releases/<커밋 sha>/` 에 올린다.
4. `sudo /srv/crabcraft/bin/activate.sh <env> <sha>` 가 `current` 링크를 새 릴리스로 바꾸고, 서버가 들어 있으면 `crabcraft-server@<env>` 를 다시 띄워 `/healthz` 를 기다린다. 응답이 없으면 바로 앞 릴리스로 되돌리고 워크플로는 실패로 끝난다. 새 릴리스의 `server-dist/` 가 지금 도는 서버가 시작한 릴리스(`/srv/crabcraft/<env>/server` 링크)와 파일 하나하나 같으면(화면만 바뀐 배포) 서버를 다시 띄우지 않아서 접속한 사람이 끊기지 않는다. 서버가 멈춰 있거나 `/healthz` 가 실패하면 그때는 다시 띄운다. 이 동작은 `bash deploy/vm/activate.test.sh`(Linux, CI 의 Deploy scripts)로 검사한다.
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

- 서버 환경 변수는 `/etc/crabcraft/dev.env`, `/etc/crabcraft/prod.env` 에 있다(`root:crabcraft`, 0640). `PORT`, `HOST`, `DATABASE_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, 그리고 Google 로그인용 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 이 들어 있다. 두 Google 값이 없으면 로그인 버튼이 "로그인 준비 중이에요" 를 보여 준다. Google 콘솔의 승인된 리디렉션 URI 는 `https://<주소>/api/account/google/callback` 이다. DB 비밀번호는 이 파일에만 있고 레포에는 없다. 값을 바꾸면 `sudo systemctl restart crabcraft-server@<env>` 로 반영한다.
- PostgreSQL 16 에 DB 와 역할이 `crabcraft_dev`, `crabcraft_prod` 로 하나씩 있다. 서로의 DB 에는 접속할 수 없다.
- Caddy 설정은 `/etc/caddy/Caddyfile`, 서버 유닛은 `crabcraft-server@.service` 다.
- 영상은 버킷 `gs://crabcraft-seonn-media/media/` 에 올린다. VM 이 10분마다 `/srv/crabcraft/media/` 로 받아 와(`crabcraft-media-sync.timer`) `/media/` 로 내보낸다. 버킷은 공개할 수 없어서 이렇게 한다.

## 서버 세계 켜고 끄기

서버가 계산하는 세계(`/world`, `docs/server-world.md`)는 `/etc/crabcraft/<env>-world.json` 이 있을 때만 켜진다. 서버가 시작할 때마다 `world-env.sh` 가 이 파일을 읽고, `assets.source` 를 그 릴리스 안의 충돌 데이터(`server-dist/world/world-manifest.json`)에 맞춰 바꾼 뒤 `/run/crabcraft/<env>-world.env` 에 `WORLD_ENABLED=1` 과 `WORLD_CONFIG_JSON` 으로 쓴다. 그래서 지형이 바뀌어 충돌 데이터가 다시 만들어진 배포에서도 세계가 그대로 뜬다. 파일이 없거나 읽을 수 없으면 세계 없이 방과 계정만 돈다(`journalctl -t crabcraft-world-env` 에 이유가 남는다).

```bash
# 켜기 (dev): 레포의 deploy/vm/world-dev.json 이 아빠가 정한 dev 수치(지금 게임과 같은 몬스터 수, #52 레벨과 재생성 시간)다
sudo install -o root -g crabcraft -m 0640 /tmp/vm/world-dev.json /etc/crabcraft/dev-world.json
sudo systemctl restart crabcraft-server@dev
# 끄기
sudo rm /etc/crabcraft/dev-world.json && sudo systemctl restart crabcraft-server@dev
```

설정을 고쳤으면 직접 `systemctl restart` 한다. 배포는 `server-dist/` 가 같으면 서버를 다시 띄우지 않는다. 설정 항목은 `docs/server-world-config.md` 에 있다.

## 채팅 신고 보기

플레이어가 채팅에서 신고하면 서버가 `chat_reports` 표에 남긴다(신고한 사람과 신고된 사람의 이름, 신고된 사람의 최근 채팅 20줄(이미 가려진 글), 방 코드, 이유, 시각. IP 주소는 남기지 않는다). 10분 안에 서로 다른 세 사람이 같은 사람을 신고하면 그 사람의 채팅은 30분 동안 본인에게만 보인다. 90일이 지난 신고는 매시간 정리할 때 지운다. VM 에서 읽기만 하는 명령으로 본다.

```bash
sudo -u crabcraft node --env-file=/etc/crabcraft/prod.env /srv/crabcraft/prod/current/server-dist/reports.mjs --hours 48
sudo -u crabcraft node --env-file=/etc/crabcraft/dev.env /srv/crabcraft/dev/current/server-dist/reports.mjs --limit 20 --json
```

## VM 설정 바꾸기

`deploy/vm/` 의 파일(Caddyfile, 유닛, 스크립트)은 워크플로가 올리지 않는다. 바꿨으면 merge 한 뒤 VM 에서 `setup.sh` 를 다시 실행한다. 여러 번 실행해도 같은 결과가 나오고, 기존 DB 비밀번호와 env 파일 값은 그대로 둔다.

```bash
gcloud compute scp --recurse deploy/vm crabcraft-1:/tmp/ --zone asia-northeast3-a --project crabcraft-seonn
gcloud compute ssh crabcraft-1 --zone asia-northeast3-a --project crabcraft-seonn --command 'sudo bash /tmp/vm/setup.sh'
```

상태 확인은 `systemctl status caddy postgresql crabcraft-server@dev crabcraft-media-sync.timer`, 로그는 `journalctl -u crabcraft-server@dev -f` 로 본다.
