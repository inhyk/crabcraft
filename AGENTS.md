# crabcraft 작업 규칙

이 레포는 아빠와 인혁이가 같이 만든다. 아빠 쪽 에이전트는 로제(Claude Code, GitHub `kubony`), 인혁이 쪽 에이전트는 효연(Codex)과 수영(Claude Code, GitHub `inhyk`)이다. 모든 에이전트가 이 파일을 따른다. 인혁이에게는 한국어로 짧고 쉽게 말하고, 영어 에러는 뜻을 풀어서 알려 준다.

## 브랜치와 주소

| 브랜치 | 들어가는 방법 | 주소 |
|---|---|---|
| `dev` | 기능 PR 머지 | https://crab-dev.seonn.dev |
| `main` | 아빠가 정할 때 `dev` 에서 `main` 으로 릴리스 PR | https://crab.seonn.dev |

- `dev` 와 `main` 은 GitHub 보호 규칙으로 PR 로만 들어간다. 직접 push, `--force` push 를 하지 않는다.
- 머지되면 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드해서 구글 클라우드 VM 에 올린다. `vercel`, `wrangler deploy` 로 배포하지 않는다.
- 아빠 레포 `kubony/crabcraft` 는 출품 기록으로 멈췄다. 거기에 push 하지 않는다.

## 작업 하나 = worktree 하나 = 브랜치 하나 = PR 하나

```sh
cd <레포 본체>
grep -qx '.worktrees/' .git/info/exclude || echo '.worktrees/' >> .git/info/exclude
git fetch origin
git worktree add .worktrees/feat-<이름> -b feat/<이름>-<YYYYMMDD> origin/dev
cd .worktrees/feat-<이름> && pnpm install
```

- 레포 본체는 `dev` 에 두고 파일을 고치지 않는다. 에이전트가 여럿이면 각자 worktree 를 만든다. 같은 작업을 이어서 고칠 때는 그 worktree 로 들어간다.
- 브랜치 이름: `feat/<이름>-<날짜>`(새 기능), `fix/<이름>-<날짜>`(고치기), `docs/...`, `chore/...`.
- 커밋 메시지는 영어 한 줄. PR 제목과 본문은 인혁이가 읽을 수 있게 쉬운 한국어.
- `dev` 가 바뀌면 작업 브랜치에 `git merge origin/dev` 로 받는다. push 한 브랜치는 rebase 하지 않는다.
- pnpm 은 10 을 쓴다(인혁이 맥북과 CI 가 10.10.0). pnpm 11 로 설치하면 `pnpm-workspace.yaml` 이 바뀌는데, 그 변경은 커밋하지 않는다.

## PR

```sh
git push -u origin feat/<이름>-<YYYYMMDD>
gh pr create --repo inhyk/crabcraft --base dev --title "<제목>" --body-file <본문>
```

PR 전에 최소 `pnpm build`(타입 검사 포함)를 통과시키고, 바꾼 곳에 맞게 `pnpm test:engine`, `pnpm test:boss`, `pnpm test:multiplayer`, `tools/qa-*.mjs`, `node tools/playtest.mjs` 를 더 돌린다. 본문에 쓴다:

- 무엇이 바뀌는지 2 줄에서 4 줄
- 실행한 검사 명령과 결과(통과, 실패 수)
- 화면 사진이 있으면 사진
- 서버(`server/`)를 바꿨거나 새 서버 기능이 필요하면 그 내용

## 머지

- 로제의 PR: 리뷰 세션(아빠가 리뷰와 머지를 맡긴 로제 창)만 머지한다. PR 을 만든 작업 세션은 PR 까지만 하고 `gh pr merge` 를 하지 않는다. 작성자가 같은 `kubony` 계정이어도 마찬가지다. 리뷰 세션은 diff, 충돌, CI 를 확인하고 검사를 직접 돌린 뒤 머지한다.
- 효연, 수영의 PR: 아빠가 확인한 뒤 머지한다. 효연, 수영은 `gh pr merge` 를 하지 않는다. PR 을 올리면 인혁이에게 번호를 알려 주고 아빠에게 봐 달라고 하게 한다.
- 기능 PR 은 squash, 릴리스 PR(`dev` 에서 `main`)은 merge commit 으로 머지한다.
- 다른 사람이 올린 PR 의 브랜치는 고치지 않는다. 고칠 것이 보이면 PR 댓글로 남긴다.

## 버전과 릴리스

- 버전은 `package.json` 의 `version` 이다. 시작 화면 맨 아래에 보인다. crab.seonn.dev 는 `v1.0.0`, crab-dev.seonn.dev 는 주황색 `DEV v1.0.0 · 9c06f54`(버전과 커밋). 배포된 버전은 `/version.json` 으로도 본다.
- 규칙: 그날(한국 시간) 첫 릴리스는 minor 를 올리고(`1.0.0` → `1.1.0`), 같은 날 다음 릴리스는 patch 를 올린다(`1.1.0` → `1.1.1`). major 는 아빠가 정할 때만. 첫 버전은 `1.0.0` 이다.
- dev 와 main 은 구현이 같을 때만 버전이 같다. dev 에 main 에 없는 변경이 하나라도 들어가면 dev 는 다음 릴리스 버전이어야 한다. 그래서 릴리스가 main 에 들어가면 바로 dev 에 `--bump` PR 을 넣는다. 릴리스하는 날이 bump 한 날과 다르면 릴리스 PR 전에 `--next` 로 다시 보고, 다르면 한 번 더 `--bump` 한다.
- 릴리스 순서:
  1. dev 의 `package.json` 이 `node tools/release-version.mjs --next` 와 같은지 본다. 다르면 `--bump` 로 바꾸고 PR 로 dev 에 넣는다. 기능 PR 에 같이 넣어도 된다.
  2. dev 에서 main 으로 릴리스 PR 을 연다. 제목에 버전을 쓴다(예: `릴리스 v1.1.0: 눈 월드 퀘스트`). `Release version` 검사가 버전을 안 올린 릴리스를 막는다.
  3. main 배포가 성공하면 `v<버전>` 태그가 자동으로 찍힌다(`deploy.yml` 의 `tag-release`).
- 릴리스 노트는 위키 `프로젝트` 콜렉션의 「Crabcraft 업데이트 안내 모음」에 버전마다 쓴다. 같은 내용을 `public/release-notes.json` 의 `notes` 맨 앞에 넣으면 시작 화면 버전 옆 "업데이트 소식" 에 나온다(`{version, date, wiki, sections:[{title, items:[{head, body}]}]}`, `src/ui/news.ts`). 노트가 하나도 없으면 링크가 숨는다.

## 머지된 뒤 정리

```sh
gh pr view <번호> --repo inhyk/crabcraft --json state --jq .state   # MERGED 일 때만
git worktree remove .worktrees/feat-<이름>
git branch -D feat/<이름>-<YYYYMMDD>
```

바뀐 파일이 남은 worktree 는 지우지 않고 무엇이 남았는지 알린다.

## 서버

- 멀티플레이 서버(방 `/multiplayer`, 계정 `/api/account/*`)는 같은 VM 의 Node 서버와 Postgres 다. 게임과 같은 주소에서 돈다.
- `server/` 를 고치는 PR 은 예전 게임 화면도 그대로 돌아가게 만든다. 게임이 새 서버 기능에 기대야 하면 서버 PR 을 먼저 머지한다.
- 비밀번호, 세션, 데이터베이스 접속 정보는 코드, 로그, PR, 위키에 쓰지 않는다.

## 디자인 기준

- 아빠의 지침: "디자인은 세계 최고를 위해 달리고, 당연히 W1보다는 더 높은 수준의 디자인 퀄리티를 항상 지향해야 한다." W1 클로헤이븐은 넘어야 할 바닥이지 목표가 아니다.
- 채점 기준 12항목과 월드별 지금 점수는 위키 「아빠의도움」의 [2026-10-18 crabcraft 디자인 기준: 세계 최고, W1보다 높게](https://wiki.repact.ai.kr/doc/2026-10-18-crabcraft-w1-bSKJId974I) 에 있다. 월드, 풍경, 화면을 바꾸기 전에 읽는다.
- 월드나 풍경을 바꾸는 PR 은 같은 카메라 자리에서 찍은 전후 사진을 본문에 넣는다.
- 원통, 원뿔, 상자와 단색 바닥만으로 만든 풍경은 임시로 본다. 한 월드 안에서는 스타일을 하나로 맞춘다.
- 남의 그림, 모델, 음악을 가져오지 않는다(공모전 규칙상 실격). 레퍼런스는 보고 배우기만 한다.

## 하지 않는 일

- `dev`, `main` 에 직접 push, `--force` push
- `vercel`, `wrangler deploy` 로 배포
- `kubony/crabcraft` 에 push
- 비공개 영상(APT 노래가 들어간 군무)이나 그 노래를 레포에 넣기
