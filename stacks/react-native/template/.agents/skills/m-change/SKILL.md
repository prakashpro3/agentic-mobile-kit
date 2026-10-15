---
name: m-change
description: Make a small change to behavior the app already has - a text, a limit, a validation rule, a style, a small UX tweak - and update the living spec and docs/amk with it, after one approval. Run only when the user explicitly invokes m-change.
disable-model-invocation: true
---

# m-change

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (the change in a sentence or two, or a task link plus pasted details).

## 1. Check that it's small

A small change adjusts behavior the app already has, in a few files: a text, a limit, a validation rule, a style, a small UX tweak. It's too big for this workflow if it needs a new screen, a new dependency, a new API call, a data migration or native files (`Info.plist`, `AndroidManifest.xml`, `build.gradle`, `Podfile`): then suggest `m-feature` and stop. If the app doesn't do what it should, it's a bug: suggest `m-bugfix`. If the change is unclear, ask one question at a time.

## 2. Find everything it touches

- **Code:** every place the behavior lives, on both platforms, including shared constants, translations and tests.
- **Living spec:** the requirement in `specs/current/<area>.md` that describes this behavior today. Behavior the living spec doesn't cover yet becomes a new requirement there.
- **Docs:** lines in `docs/amk/` that the change makes untrue.

## 3. One approval

Show in one message:
- each file to change, and how;
- the requirement as it is and as it will be, or the new one;
- the doc lines that change;
- how it will be checked: a test where logic changes, and the screens on both platforms for anything visible.

**Stop until the user approves.** On the main branch, suggest a new branch first.

## 4. Make it

If no requirement changes, as with a pure style change, skip the spec files (steps 1, 5 and 6 below).

1. Pick an ID: the task's ID if it has one, otherwise `YYYYMMDD-<slug>`. Write `specs/<id>/requirements.md` with a title, a one-line goal and only the requirements that change, under `## MODIFIED Requirements: <area>` (or ADDED or REMOVED; the format is in `specs/current/README.md`). Run `node scripts/amk/specs.js check specs/<id>/requirements.md`.
2. Change the code, and add or update a test where logic changed.
3. Run `sh scripts/amk/verify.sh quick` and show its output.
4. For a visible change, write `.maestro/<id>.yaml` from `specs/_templates/flow.yaml`: open the changed screen and take a screenshot. Check it on the devices as `sh scripts/amk/verify.sh plan --spec <id>` says (one command, or each device in its own `m-device-checker` subagent at the same time, as in `m-feature`'s step 5), and open the screenshots in `.amk/evidence/<id>/`. Off a Mac it checks Android only: say that iOS still needs checking on a Mac.
5. Run `node scripts/amk/specs.js merge <id>` to update the living spec, and change the doc lines from step 3.
6. Copy `specs/_templates/progress.md` to `specs/<id>/progress.md`, set `Status: done`, and write down the checks and their results.

If the change turns out bigger than it looked, stop and suggest `m-feature`, carrying over what you found.

## 5. Commit

Commit the code, `specs/<id>/`, `specs/current/` and the docs together, with a clear message ending in `Spec: specs/<id>`. Ask before pushing. Then open a pull request that starts with the requirement change and shows the evidence.
