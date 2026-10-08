---
name: m-explore
description: Think a problem through before committing to a change - read the code, explain how something works today, and lay out options with trade-offs. Never edits code. Run only when the user explicitly invokes m-explore.
disable-model-invocation: true
---

# m-explore

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (a problem, a question about how something works, or an idea to check).

1. **Read before answering.** Start with `specs/current/` and `docs/ai/` for the area, then the code itself. Back each claim with the file and line it comes from. Don't guess; say what you couldn't find.
2. **Explain what's there today:** the screens, state, API calls and native parts involved, and where iOS and Android differ.
3. **When there's a choice, lay out options:** two or three, each with its trade-offs (effort, risk, both platforms, native changes, store review, what it leaves unsolved). Say which one you'd pick and why. Diagrams help when the flow is complicated.
4. **Change nothing.** Exploring never edits code, config or project files. Write notes only when the user asks: a draft in `specs/<id>/requirements.md` for `m-feature`, or a decision in `docs/ai/decisions.md`.
5. **Hand off when it's clear.** Suggest the next step: `m-feature <one-line summary>` or `m-bugfix <one-line summary>`, carrying over what you found. If the idea turns out not to be worth doing, say so; learning that cheaply is a good outcome.
