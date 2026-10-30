# <ID>: <title>

Source: <link to the task in Excel, Trello or the task platform>

## Goal

<!-- One or two sentences: what the user can do after this change, and why.
     One intent you can say in a sentence: if it needs "and also", it's two features. -->

## User stories

<!-- Who it's for and why: a story for each kind of user or need (one is often enough). Its acceptance criteria are its
     requirements' scenarios, so it names those rather than repeating them. Add Priority (must, should or could),
     Depends on (another story, spec, API or permission) or Notes only when they say something the Goal doesn't. -->

### US-1: <short title>
As a <kind of user, in the glossary's words>, I want <capability>, so that <benefit>.
- Requirements: <requirement names below>

## Use cases

<!-- The journey step by step, and what can go differently. Each alternative flow and exception names the scenario that
     tests it, and business rules name requirements. A one-screen feature has one short use case ("Alternative flows: none"). -->

### UC-1: <the user's goal>
- Actors: <primary>; <others: another user, the backend, a payment provider, the OS>
- Stories: US-1
- Preconditions: <what's true before>
- Trigger: <what starts it>
- Main flow: 1. … 2. … 3. …
- Alternative flows: 2a. <variation> → Scenario: <name>
- Exceptions: 3a. <offline, a denied permission, a server error> → Scenario: <name>
- Postconditions: <what's true after, on success and on failure>
- Business rules: <requirement names>

## ADDED Requirements: <area>

<!-- <area> names the living spec file specs/current/<area>.md (for example login or tasks); read it first.
     Each requirement is one behavior, with SHALL (or MUST), that someone who can't see the code could check.
     Scenarios are concrete cases that prove it, edge and error cases included; name the case in the title.
     Format and examples: specs/current/README.md. -->

### Requirement: <name>
The app SHALL <behavior>.

#### Scenario: <the case, for example "Rejects an expired code">
- GIVEN <starting state>
- WHEN <action or event>
- THEN <what the user sees or what happens>

## MODIFIED Requirements: <area>

<!-- Requirements already in specs/current/<area>.md that this changes: copy each one, keep its name, edit it.
     Delete this section if nothing existing changes. -->

## REMOVED Requirements: <area>

<!-- Requirements in specs/current/<area>.md that go away: "### Requirement: <name>" and a line on why.
     Delete this section if nothing is removed. -->

## Edge cases (answer each, or write "n/a")

<!-- Each case that matters gets a scenario above. -->
- Offline or slow network:
- Server error, timeout:
- Empty, loading and long-content states:
- Permission denied (camera, location, notifications…):
- App backgrounded and resumed mid-flow:
- Small phones, large phones, tablets; dark mode:
- Accessibility (screen reader labels, font scaling):
- iOS vs Android differences:
- Analytics events:

## Out of scope

## Open questions

<!-- The agent stops for answers before design starts. -->

## Changes after approval

<!-- Empty until the requirements are approved (the commit "docs(spec): <id> approved"). Each change after that gets an
     entry here and waits for the user's approval, as the requirements did:
     ### <date>: <requirement name>
     - Before → after: <the change, or `git diff <approval commit> -- specs/<id>/`>
     - Why: <the reason>
     - Impact: <the stories, scenarios, tasks, tests and flows that change, and what else could break>
     - Approved: <who, and when> -->
