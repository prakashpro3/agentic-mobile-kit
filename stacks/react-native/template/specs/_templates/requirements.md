# <ID>: <title>

Source: <link to the task in Excel, Trello or the task platform>

## Goal

<!-- One or two sentences: what the user can do after this change, and why.
     One intent you can say in a sentence: if it needs "and also", it's two features. -->

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
