# Plan

<!-- The features to plan all, then build. Only the planning session writes this file, on the `plan` branch, which is
     never merged: each feature's spec reaches main with that feature's PR. `/m-feature build` reads it from there.
     Approvals come in three layers, each a stop: this feature map; the stories, use cases and shared design; then the
     detail, a batch at a time. `node scripts/amk/specs.js check --plan` checks it; `specs.js status` shows where each
     feature stands and adds up the sizes. -->

Approved: <the layers approved so far, with their dates: feature map; stories and shared design>

## Features

<!-- One row per feature, in build order.
     Feature: its spec id (YYYYMMDD-<slug>, or the task's id). Goal: one line, what the user can do.
     Depends on: the features it needs built first (planned, or already built), comma-separated, or none. A feature that
       MODIFIES a requirement another planned feature ADDS depends on it.
     Batch: about two or three days of building each, never before a feature it depends on.
     Size: hours, rough (~6) until its tasks are written; then specs.js status counts them (a task is about an hour).
     Status: drafting, questions open, ready for approval, approved, changes requested: <what>, or held: <waiting on
       whom or what>. The build takes only approved features. -->

| # | Feature | Goal | Depends on | Batch | Size | Status |
|---|---|---|---|---|---|---|
| 1 | <id> | <what the user can do> | none | 1 | ~6 | drafting |

## Shared design

<!-- What several features share, approved with the stories. In an app with features built already, only what's new.
     Words the plan adds go here, not in docs/amk/glossary.md: docs on the plan branch never reach main, and the build
     adds them to the glossary with the first feature that uses them. Same format: **<Term>**: what it is. _Not:_ <other words>. -->

- Data model:
- Navigation:
- Shared components:
- UI/UX level: <Simple, Mixed or Premium, as in specs/_templates/design.md>
- Dependencies to add:
- New words:

## Approved up front

<!-- What the build does without asking, approved with the stories and shared design. -->

- Pushing a `feature/<id>` branch and opening a pull request for each feature
- Adding the dependencies the shared design lists
- The look: <the prototype's screenshots, or docs/amk/design-system.md>

## Summaries

<!-- One per feature, for reviewing the plan without reading every spec: what the counts don't show. -->

### <id>
- Assumptions: <what the spec assumes that nobody confirmed, or none>
- Risk: <low, medium or high, and why>
- Waiting on: <none, or whom, with specs/<id>/questions-<who>.md: until it's none, the feature is held, and the build won't take it>
