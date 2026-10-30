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
