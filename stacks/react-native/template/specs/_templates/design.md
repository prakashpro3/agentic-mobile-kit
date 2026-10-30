# <ID>: design

## UI/UX level

<!-- For a feature with screens: the level the user confirmed before the design, and the date (n/a without screens).
     Simple (the default): clean, minimal and functional. The app's own components and theme
       (`docs/amk/design-system.md`), or the platform's standard ones; a clear hierarchy with room around it; standard
       navigation, lists and forms; motion only where the platform gives it (screen transitions, pressed states).
     Mixed: Simple, with modern touches where they help: cards with rounded corners and soft shadows, an accent colour
       and icons, subtle transitions and feedback when something changes, skeletons while loading, friendly empty and
       error states.
     Premium: polished and visually engaging, following current iOS and Android design (Apple's Human Interface
       Guidelines, Material 3): one type scale, spacing and colour tokens, dark mode, purposeful motion (shared
       transitions, gestures), haptics on key actions, illustrations for empty states. It takes longer, and may need a
       library (animation, haptics): ask before adding one.
     Every level meets the same requirements and the screen rules (accessibility, large text, Reduce Motion, both
     platforms): the level changes how the screens look and move, not what they do. -->

## Existing code to reuse

<!-- Search first: components, hooks, API clients and helpers this change will use instead of writing new ones. -->

## Approach

<!-- Screens, components, state, API calls, native changes (if any). Keep it to what the task needs. -->

## Files to change

## Tests

<!-- How each scenario is checked, approved with the design. `node scripts/amk/specs.js tests <id>` lists what tests the
     areas this touches. A Jest test is named after its scenario; a flow block is "# Scenario <n>: <name>" in .maestro/<id>.yaml;
     manual steps only for what a flow can't do (a payment sheet, a push notification). -->

| Scenario | Check |
|---|---|
| <name> | <Jest: file "it() title", a flow block, or manual: steps> |

- To change or retire: <what checks a requirement this modifies or removes, and what happens to it>, or none
- Regression: <the command specs.js tests prints, with the flows no spec links to that this touches>

## Risks

<!-- What could break; anything that needs a native rebuild or pod install. -->
