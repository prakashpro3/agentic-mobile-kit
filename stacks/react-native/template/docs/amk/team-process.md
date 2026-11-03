# Team process for AI-assisted work

- The person who opens a PR owns it and must be able to explain every change without AI.
- A commit made for a spec ends with `Spec: specs/<id>`.
- Keep PRs under 600 changed lines ({{PR_SIZE_LIMIT}}).
- Run at most 2 or 3 agents in parallel per person.
- Don't use "skip permissions", "YOLO" or auto-run modes in any tool.
- Keep secrets out of the repo folder; inject them at run time.
- Review the metrics and the `m-learn` changes (`git log --grep 'chore(learn)'`) once a month. Re-check `AGENTS.md` and `docs/amk/` after every React Native, Xcode or Android Gradle Plugin upgrade, and after switching AI models.

## Settings for the agents

- Feature mode: ask
  <!-- What /m-feature does, given no task, when docs/amk/product.md plans several features without a spec: ask (offer
       both), feature-by-feature (each with its own approvals), or plan-all (plan every feature first, approved in
       batches, then /m-feature build). -->
- Reviewers: team
  <!-- team: another person approves each pull request, and the build turns on auto-merge (pr.js automerge), so it
       merges once approved and green; only where main requires an approval, else a person merges it. solo: GitHub doesn't let you approve your own pull request, so you review it and
       add the amk-ready label, which turns on auto-merge (.github/workflows/amk-ready.yml); a new commit takes the
       label off again. Create the label once: gh label create amk-ready. Branch protection: docs/branch-protection.md in
       the kit. -->
- Merge method:
  <!-- merge, squash or rebase, for auto-merge; empty: the first the repository allows, in that order. -->
- Open PRs before the build waits: 5
  <!-- node scripts/amk/autopilot.js starts no new planned feature while this many of the plan's pull requests wait for
       review. -->
- First PR review: off
  <!-- on: once the plan's first pull request is open, autopilot.js builds nothing new until a person approves or merges it,
       so a wrong pattern doesn't spread over every feature. -->
- Blocked questions as issues: off
  <!-- on: a feature the unattended build blocks gets a GitHub issue "Blocked: <id>" with its question, and m-continue
       reads the answer there. Off by default: clients often watch their private repositories, and agents don't message
       clients. -->
- Variables for unattended runs: none
  <!-- autopilot.js gives each session only PATH, HOME, the tool's sign-in, GH_TOKEN, what builds need (LANG, JAVA_HOME,
       ANDROID_HOME, SSH_AUTH_SOCK, a package registry token, proxies) and the AMK_ settings. Names of other variables
       the app's build needs, comma-separated (autopilot.js check shows a build failing without them). -->
