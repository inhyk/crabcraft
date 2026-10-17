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

- 로제의 PR: 로제가 검사를 통과시킨 뒤 머지한다.
- 효연, 수영의 PR: 아빠가 확인한 뒤 머지한다. 효연, 수영은 `gh pr merge` 를 하지 않는다. PR 을 올리면 인혁이에게 번호를 알려 주고 아빠에게 봐 달라고 하게 한다.
- 기능 PR 은 squash, 릴리스 PR(`dev` 에서 `main`)은 merge commit 으로 머지한다.
- 다른 사람이 올린 PR 의 브랜치는 고치지 않는다. 고칠 것이 보이면 PR 댓글로 남긴다.

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

## 하지 않는 일

- `dev`, `main` 에 직접 push, `--force` push
- `vercel`, `wrangler deploy` 로 배포
- `kubony/crabcraft` 에 push
- 비공개 영상(APT 노래가 들어간 군무)이나 그 노래를 레포에 넣기
