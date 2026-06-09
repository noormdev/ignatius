## Conducting the interview

How to run every mode well. These reflect how Claude works best as an interactive guide, and they apply throughout — read this before asking the first question.

- **One question at a time.** Ask the current step's question, wait for the answer, then continue. Dumping the whole flow into one prompt makes the user skim and skip the business context (Step E9) that gives the model its value.
- **Explain the WHY when you ask for something non-obvious.** "Parent PK columns first, because key-inherited propagates them into the child key" lands better than a bare demand and teaches the convention as you go. State motivation, not just the rule.
- **Act, don't just suggest.** Once a step's answer is in hand, write or update the file — do not stop at proposing YAML and waiting for permission. The user invoked the skill to produce files. Writing into the model directory is local and reversible; only confirm before overwriting an existing entity.
- **Infer before asking.** Read existing entities, `_groups/`, and `ignatius.yml` first to detect the convention, list groups, and prefill answers. Ask only what the files cannot tell you.
- **Reflect after verification.** When `ignatius validate` returns findings, read them and decide the smallest set of Q&A steps to re-ask before rewriting. Do not blindly regenerate the whole file.
- **Self-check before declaring done.** The linter checks structure, not story. A clean validate run is necessary but not sufficient. Before reporting success, confirm the entity actually captured its business rules and rationale (Step E9) and that each predicate reads as a true sentence in both directions — these are the parts no rule can catch.
- **Prefer the positive form.** Tell the user what to write, with a concrete example, rather than listing what to avoid.

---
