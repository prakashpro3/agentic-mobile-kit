---
name: m-feature
description: Build a feature from a requirement (pasted text, a file, or a task link), from spec to pull request. Run only when the user explicitly invokes m-feature.
disable-model-invocation: true
---

# m-feature

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (the requirement text, a file path, or a task link plus pasted details).

## 1. Always use the full flow

The user chose `m-feature`, so follow every step below, however small the change looks. Never skip the spec or the approval stops on your own judgment. (Tiny changes don't need this skill; the user can just ask for them directly.)

If the input describes a bug rather than new behavior, suggest `m-bugfix` and stop. If it's still a vague problem ("the checkout feels slow") or an area you'd have to learn first, suggest `m-explore` first.

## 2. Requirements (then stop for approval)

1. Pick an ID: the task's ID if it has one, otherwise `YYYYMMDD-<slug>`. Copy `specs/_templates/` to `specs/<id>/`.
2. Read `specs/current/<area>.md` for each area this touches: it says what the app does now. In an area with no living spec yet, read the code that implements it.
3. **One intent.** The feature should be one thing you can say in a sentence. If it needs "and also", suggest splitting it into separate features, and ask.
4. Fill `requirements.md`: the goal; the requirements under `## ADDED`, `## MODIFIED` and `## REMOVED Requirements: <area>` (the format is in `specs/current/README.md`), with one SHALL per requirement and scenarios for the cases that matter; every edge-case line (or "n/a"); out of scope; open questions. Then run `node scripts/amk/specs.js check specs/<id>/requirements.md`.
5. If something is unclear, ask the user **one question at a time**. Don't fill gaps with guesses.
6. Show the requirements and **stop until the user approves them**. Give the user these questions to check them against:
   - Is this the problem you asked me to solve, with nothing extra in scope?
   - Could someone test each requirement without reading the code?
   - Does a scenario cover the case you care about most?

## 3. Design and tasks (then stop for approval)

1. **Search the codebase before designing.** List the components, hooks, API clients and helpers you'll reuse in `design.md` under "Existing code to reuse". Read `docs/amk/structure.md` and `docs/amk/conventions.md`.
2. Fill `design.md`: approach, files to change, risks (native changes, pod install, migrations).
3. Fill `tasks.md`: small tasks (about an hour, under ~300 changed lines each). Each task names the requirement it serves and how it's checked, and its tests are written in the same task, not left for the end. The last task writes `.maestro/<id>.yaml` (from `specs/_templates/flow.yaml`): a Maestro flow with one step and screenshot per scenario, tapping elements by `testID`.
4. Show design and tasks and **stop until the user approves them**. Ask them to check that every task serves an approved requirement and nothing goes beyond the agreed scope.

From here the plan lives in files, so the building can also run in a fresh session or another tool with `m-continue <id>`.

## 4. Build, one task at a time

For each task:
1. Implement only that task. Write tests first for logic (state, data, utils); UI can be tested after.
2. Run `lint`, `typecheck` and `test` (see AGENTS.md). Paste the real output. If something fails, fix it; after 2 failed attempts, stop and report.
3. Commit with a clear message ending in `Spec: specs/<id>`.
4. Tick the task in `tasks.md` and update the handoff block and log in `progress.md`.

If building shows the plan is wrong: when the intent is the same, update `requirements.md`, `design.md` or `tasks.md`, tell the user what changed, and ask again before going on if a requirement changed. When the intent itself changed, or the scope grew into different work, stop and suggest finishing this feature small and starting a new one.

## 5. Check against the spec

When all tasks are done:
1. Run `sh scripts/amk/verify.sh all --spec <id>`. Off a Mac it checks Android only: record in `progress.md` that iOS still needs `verify.sh ios --spec <id>` on a Mac, and say so in the PR. Then **open the screenshots** in `.amk/evidence/<id>/` and check each one against its scenario. Maestro can report a tap as passed when nothing happened, so the screenshots are the evidence, not the log.
2. Go through every scenario and note its evidence: a test name, command output, or the screen checked. Where the code and the spec disagree, fix whichever is wrong, asking first if it's the spec. The spec must describe what ships.

## 6. Update the living spec

Run `node scripts/amk/specs.js merge <id>`. It applies the ADDED, MODIFIED and REMOVED requirements to `specs/current/` and notes the source of each. If it refuses, the reason is usually that a requirement listed as ADDED already exists, or one listed as MODIFIED doesn't. Fix `requirements.md` and run it again. Commit `specs/current/` with the feature, so reviewers see the change in behavior.

## 7. Review and pull request

1. Run `m-review` (or ask the `m-reviewer` subagent, if your tool has subagents). Fix real problems only; skip style nits.
2. Ask the user before pushing. Then push the feature branch (never `main`) and open a PR. Start the description with the requirements this adds, changes and removes, so reviewers read what should be true before the code. Then add the evidence: lint, typecheck and test output, and the screenshot for each scenario. Use `.github/pull_request_template.md` if the repo has one.

Never claim a check passed without running it in this session.
