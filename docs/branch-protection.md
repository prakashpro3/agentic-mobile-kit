# Branch protection

CI only enforces anything if a failing check blocks the merge. Turn this on for `main` in every app repo.

**Plan requirement:** GitHub allows branch protection on public repos for free. Private repos need GitHub Pro (personal account) or GitHub Team (organization).

## Set it up (GitHub CLI)

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "checks": [ { "context": "checks" } ] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "require_code_owner_reviews": true },
  "restrictions": null
}
EOF
```

- `checks` is the summary job in `.github/workflows/ci.yml`. It fails when any job the change calls for failed, was cancelled, or was skipped though the change needed it: the tests and the Android build for code, the iOS build for native files (and an Expo app's config, plugins and native dependencies), none of them for a change to specs or docs only. That's the one check to require. A protection set up before 0.12.0 also requires `android`: that keeps working, as a job skipped because the change doesn't call for it counts as passed.
- `enforce_admins: true` means admins can't skip the rules either.
- `required_approving_review_count`: 1 or more for a team. For a developer who works alone, 0, with `Reviewers: solo` in `docs/amk/team-process.md` (below).
- `require_code_owner_reviews: true` (a team): a change to the files `CODEOWNERS` lists (below) needs one of their owners' approval. A developer who works alone sets it to `false`: nobody can approve their own pull request.

## Code owners

The kit's guardrails (its scripts, hooks and tool settings, the workflows, the agents' instructions, the coverage floors and size caps) should need a person's review when a pull request changes them. An unattended build can't change them (the guard and the pre-commit hook refuse it); this covers everyone else. Add to `.github/CODEOWNERS`, with your own people or team:

```
/scripts/amk/        @your-team
/.githooks/          @your-team
/.rulesync/          @your-team
/.github/            @your-team
/.agents/            @your-team
/.claude/            @your-team
/.codex/             @your-team
/AGENTS.md           @your-team
/CLAUDE.md           @your-team
/rulesync.jsonc      @your-team
/.amk-coverage       @your-team
/.amk-size-caps      @your-team
/.amk-secrets        @your-team
```

## Auto-merge

The build turns on auto-merge for its pull requests into `main` (`node scripts/amk/pr.js automerge`), so each merges once a person approves it and its checks pass. Turn it on for the repository first:

```sh
gh api -X PATCH repos/<owner>/<repo> -f allow_auto_merge=true
```

- **A team** (`Reviewers: team`, the default): another person approves each pull request; the build turns auto-merge on.
- **A developer who works alone** (`Reviewers: solo`): GitHub doesn't let you approve your own pull request, so require no approvals, and after reviewing a pull request add the `amk-ready` label (create it once: `gh label create amk-ready --description "Reviewed: auto-merge once the checks pass"`). `.github/workflows/amk-ready.yml` turns auto-merge on; a new commit takes the label off again, so nothing you haven't seen merges. The build never turns auto-merge on itself in solo mode, and AI tools never add the label.
- `Merge method:` in `docs/amk/team-process.md` picks merge, squash or rebase; empty, the first the repository allows.
- A stacked pull request (one built on another feature's branch) goes into that branch at first, and the build leaves auto-merge off for it there. Once its parent merges, `pr.js forward` merges `main` into it, moves it onto `main`, and turns auto-merge on (for a team).
- A merge done by auto-merge from the `amk-ready` workflow is made with the workflow's token, so it doesn't start the `push` workflows on `main` again; the pull request's own checks ran already.

## The AI jobs (optional)

`--ci github,ai` adds `.github/workflows/amk-ai-review.yml` (an AI reviews each ready pull request and comments) and `amk-ai-deps.yml` (an AI fixes a dependency update whose CI fails, without changing versions). They comment or push fixes; they never approve. Each needs:

- the `ANTHROPIC_API_KEY` secret;
- a GitHub App for the AI jobs, installed on the repository, with **contents and pull requests: read and write**, and nothing else (no administration, no workflows). Its client ID goes in the `AMK_APP_CLIENT_ID` variable and its private key in the `AMK_APP_PRIVATE_KEY` secret. A push made with the workflow's own token doesn't start CI again; the App's does, so a fix gets checked.

They start only for a person with write access (or, for the dependency job, Dependabot or Renovate), skip forks, drafts and their own fixes, stop after three fix commits in a row on a branch or six runs in an hour, and pause themselves after three failures in a row: an issue "AI job paused: <job>" says so, and closing it resumes the job (`scripts/amk/ai-job.js`). The dependency job installs the updated packages and runs their code in its checks, with the App's token and the API key in reach: turn it on only if you accept that.

## Verified on a test repo

2026-10-08:
- A direct push to `main` was rejected: "protected branch hook declined".
- A PR with a failing test showed merge state BLOCKED.
- A PR with all checks green merged normally.

2026-11-03, with 0.12.0, under a protection from before it (`checks` and `android` required, no approvals):
- The kit's update merged by auto-merge (`pr.js automerge`) once its checks passed, and the merge started CI on `main`.
- A change to docs only skipped the tests and both builds, and was mergeable: the skipped `android` counted as passed.
- The `amk-ready` label turned auto-merge on, and the pull request merged once green; that merge started no CI on `main`.
- On a pull request whose test failed in CI only, `pr.js checks` handed over the failing test's log, and a new commit took the label and auto-merge off, with a comment.
