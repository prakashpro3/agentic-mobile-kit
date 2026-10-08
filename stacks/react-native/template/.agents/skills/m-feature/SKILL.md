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

If the input describes a bug rather than new behavior, suggest `m-bugfix` and stop.

## 2. Requirements (then stop for approval)

1. Pick an ID: the task's ID if it has one, otherwise `YYYYMMDD-<slug>`. Copy `specs/_templates/` to `specs/<id>/`.
2. Read `specs/current/` for the areas this touches, so new requirements build on what the app does now. Where they change a current requirement, say which one.
3. Fill `requirements.md`: goal, acceptance criteria as "WHEN … THE APP SHALL …", every edge-case line (or "n/a"), out of scope, open questions.
4. If something is unclear, ask the user **one question at a time**. Don't fill gaps with guesses.
5. Show the requirements and **stop until the user approves them**.

## 3. Design and tasks (then stop for approval)

1. **Search the codebase before designing.** List the components, hooks, API clients and helpers you'll reuse in `design.md` under "Existing code to reuse". Read `docs/ai/structure.md` and `docs/ai/conventions.md`.
2. Fill `design.md`: approach, files to change, risks (native changes, pod install, migrations).
3. Fill `tasks.md`: small tasks (about an hour, under ~300 changed lines each), each with its own check. The last task writes `.maestro/<id>.yaml` (from `specs/_templates/flow.yaml`), a Maestro flow that walks through the acceptance criteria, taps elements by `testID` and takes a screenshot per criterion.
4. Show design and tasks and **stop until the user approves them**.

## 4. Build, one task at a time

For each task:
1. Implement only that task. Write tests first for logic (state, data, utils); UI can be tested after.
2. Run `lint`, `typecheck` and `test` (see AGENTS.md). Paste the real output. If something fails, fix it; after 2 failed attempts, stop and report.
3. Commit with a clear message ending in `Assisted-by: <tool>/<model>` and `Spec: specs/<id>`.
4. Tick the task in `tasks.md` and update the handoff block and log in `progress.md`.

## 5. Check against the spec

When all tasks are done:
1. Run `sh scripts/ai/verify.sh all --spec <id>`. Then **open the screenshots** in `.ai/evidence/<id>/` and check each one against its criterion. Maestro can report a tap as passed when nothing happened, so the screenshots are the evidence, not the log.
2. Go through every acceptance criterion and note the evidence for it (test name, command output, or screen checked). If one isn't met, fix the code or ask whether the spec should change.

## 6. Update the living spec

Add the acceptance criteria that are now true to `specs/current/<area>.md`, one file per area of the app (the format is in `specs/current/README.md`). Add new requirements, rewrite the ones this feature changed, and delete the ones it removed, each with `Source: specs/<id>`. The file describes only what the app does now. Commit it with the feature, so reviewers see the change in behavior.

## 7. Review and pull request

1. Run `m-review` (or ask the `m-reviewer` subagent, if your tool has subagents). Fix real problems only; skip style nits.
2. Ask the user before pushing. Then push the feature branch (never `main`) and open a PR with the evidence: lint, typecheck and test output, and the screenshots checked against each criterion. Use `.github/pull_request_template.md` if the repo has one.

Never claim a check passed without running it in this session.
