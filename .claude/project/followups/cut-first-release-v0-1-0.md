---
id: cut-first-release-v0-1-0
title: Cut the v0.1.0 release after GitHub repo exists
created: "2026-05-28"
origin: |
    release-pipeline work, deferred per user request 2026-05-28
severity: question
review_by: "2026-07-27"
status: open
---

After noormdev/ignatius exists on GitHub and the workflow files are on master, trigger the first release via release-please:

1. release-please workflow runs on push to master
2. It opens a "release v0.1.0" PR with the CHANGELOG
3. Merging that PR creates the v0.1.0 tag
4. The release workflow fires on the tag, cross-compiles 5 binaries, attaches them + checksums.txt to the GitHub Release
5. Users can then download via the URLs documented in README

Nothing to implement here — this is a manual gate that follows from the GitHub setup follow-up above.
