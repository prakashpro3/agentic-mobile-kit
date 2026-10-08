# Branch protection

CI only enforces anything if a failing check blocks the merge. Turn this on for `main` in every app repo.

**Plan requirement:** GitHub allows branch protection on public repos for free. Private repos need GitHub Pro (personal account) or GitHub Team (organization).

## Set it up (GitHub CLI)

```sh
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "checks": [ { "context": "checks" }, { "context": "android" } ] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
EOF
```

- `checks` and `android` are the job names in `.github/workflows/ci.yml`. The `ios` job runs only when native files change, so it isn't required by default. Add `"build"` to the list if every PR should wait for iOS.
- `enforce_admins: true` means admins can't skip the rules either.
- Set `required_approving_review_count` to 1 or more for team repos. Use 0 only for solo projects.

## Verified on a test repo (2026-10-08)

- A direct push to `main` was rejected: "protected branch hook declined".
- A PR with a failing test showed merge state BLOCKED.
- A PR with all checks green merged normally.
