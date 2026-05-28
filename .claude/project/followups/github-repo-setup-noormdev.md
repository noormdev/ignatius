---
id: github-repo-setup-noormdev
title: Push to GitHub as noormdev/ignatius + replace README URL placeholders
created: "2026-05-28"
origin: |
    release-pipeline work, deferred per user request 2026-05-28
severity: risk
review_by: "2026-07-27"
status: open
---

Push the repo to GitHub under the noormdev organization as noormdev/ignatius. One-time setup:

  gh repo create noormdev/ignatius --public --source=. --remote=origin
  git push -u origin master

Then update the README install URLs (search for `<owner>/<repo>` placeholder) and replace with noormdev/ignatius.

Until this is done, the release pipeline cannot fire — workflows are committed but inert.
