Changelog
=========

0.3.1 (2026-11-25)
------------------

* Renders `color` questions as a colour input, starting at the question's
  default.
* Requires `@askdown/core` 0.3.1.


0.3.0 (2026-11-24)
------------------

* Renders `switch` questions as a checkbox with the `switch` ARIA role, with
  the label beside it. `readAnswers()` reads a switch that wasn't submitted as
  off (`false`).
* Tests use the `@askdown/spec` package instead of a vendored copy of the spec.
* Releases are published from GitHub Actions with trusted publishing, and
  staged on npm for approval.
* Added a Test workflow that type-checks, tests and builds on every push to
  main and every pull request.
* Releases are staged on the vlt registry too, with `npm stage publish` (vlt
  has no stage command), and approved the same way as on npm.
* The publish jobs are safe to re-run: a version that is already published, or
  already staged on npm, is skipped instead of failing the job.
* Fixed publishing to the vlt registry from GitHub Actions: npm now sends the
  trusted-publishing token exchange to the vlt registry with credentials,
  instead of failing with ENEEDAUTH.
* Requires `@askdown/core` 0.3.0, which adds the `switch` question type and
  removes the `checkboxes`, `dropdown` and `textarea` type aliases.


0.2.1 (2026-11-12)
------------------

* Changes up to this version are in the git history.
