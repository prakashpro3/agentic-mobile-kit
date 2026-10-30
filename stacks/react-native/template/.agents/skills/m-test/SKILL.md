---
name: m-test
description: Test a change or a release - lint, types and tests, the device flows of a spec and the areas it touches, then a read-only tester gives each scenario a status and the test report says Ready or Not ready. Run only when the user invokes m-test, or when m-feature, m-change, m-bugfix or m-release says to.
disable-model-invocation: true
---

# m-test

The user chose this workflow, directly or through `m-feature`, `m-change`, `m-bugfix` or `m-release`: follow its steps, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (a spec ID; or `release <version>`, with the flows `m-release` chose).

1. **Scope.** The spec's test plan (`## Tests` in `design.md`), or its scenarios when it has none, and `node scripts/amk/specs.js tests <id>` (a release: `specs.js tests`): the flows to run, the tests to change or retire, and the scenarios nothing checks.
2. **Code checks.** `sh scripts/amk/verify.sh quick --label <id>` (the whole test suite, compared with the base branch), and `node scripts/amk/coverage.js check` when the app has `.amk-coverage`. Their output stays in `.amk/evidence/<id>/`.
3. **Devices,** for the flows the scope lists: `sh scripts/amk/verify.sh plan` with the options of the test plan's regression command (`--spec <id>,<the specs of the areas it touches> --label <id>`). It says how many devices this machine's memory can check at the same time, and prints the commands.
   - **One command** (`verify.sh all` with those options): run it.
   - **A plan, and your tool has subagents:** run its `quick` and `build` commands as printed (nothing added: the plain commands are the ones people allow), then, round by round, start one `m-device-checker` subagent per device command of the round, all at once, and wait for their reports before the next round. When all are back, check them yourself: every screen has screenshots in its folder, or in each `part-k/` folder when its flows ran in parts. A report alone isn't evidence. Without subagents, run that `verify.sh all` command instead.

   `verify.sh` compares each screenshot with the approved one and lists those that changed: open every one it lists, and at least one per screen. Once the user accepts how they look, `sh scripts/amk/verify.sh approve --label <id>` makes them the approved ones. Off a Mac it checks Android only: iOS is blocked (no Mac) until a teammate runs it. Maestro can report a tap as passed when nothing happened, so the screenshots are the evidence, not the log.
4. **The verdict.** Give the `m-tester` subagent the spec ID (or the release), the evidence folder and what didn't run and why; without subagents, follow `.rulesync/subagents/m-tester.md` yourself. It gives each scenario a status and ends with Ready or Not ready.
5. **The report.** Write `specs/<id>/test-report.md` (a release: `release-notes/<version>/test-report.md`) from `specs/_templates/test-report.md`, and show the verdict.
6. **After a fix,** run the failed flows again with `--flow <file>`, then the whole set, and update the report. After two failed attempts at the same fix, stop and report.

Never count a check as passed without this run's evidence.
