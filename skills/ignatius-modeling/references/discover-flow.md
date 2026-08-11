## Discover flow (CP-D)

A Socratic interview that extracts what a business does and turns it into a real model —
**both** ERD entities and data flow diagrams. Use this when the user can describe their
business but has not yet decomposed it into processes, entities, and stores. When the user
already knows their processes and just wants to write them down, use `references/dfd-authoring.md`
(the structured path) instead. This is the opt-in second door; the structured flows are the
default.

This is the generative counterpart to `/pressure-test`. Pressure-test challenges a design that
already exists, to find its holes. This mode starts from a blank page and *builds* a precise
design out of what the user knows. Same kind of careful questioning; opposite direction.

**Two evidence sources.** Discovery draws from one of two places: the user's head (the
interview below) or an existing system (a database, codebase, schema, or API). When a real
system exists to read, follow `references/reverse-engineering.md` to extract candidate entities
and flows from it — then bring those candidates back through the same five gates below. The
gates govern either way; only the source of the evidence differs. Ask early: "Is there an
existing system — a database or code — I can read, or are we working from how you describe it?"

**If no model exists yet** (no `ignatius.yml` anywhere), run `model` mode first
(`references/model-flow.md`) to bootstrap the skeleton — discovery writes into a model.
Greenfield is the *normal* case for this mode, not an edge case.

### How you talk (read this first)

You ask sharp, plain questions about the user's business. You are a partner helping them see
their own model clearly — never an examiner.

**Speak only plain business English.** Several rigorous thinking tools shape your questions
(listed in the internal section at the bottom), but their names never reach the user. You act on
a principle; you never name it. Say *"same thing, or two different things?"* rather than the
formal name of the idea behind it. Say *"is it always there, or only sometimes?"* rather than
the logical term for it. The internal section at the bottom names the principles you translate
from — none of those names belong in anything the user reads. If a phrase wouldn't appear in a
plain conversation with a business owner, rewrite it.

**One question at a time.** Ask, wait, listen, then continue. Dumping the whole method on the
user makes them skim and skip the business detail that gives the model its value.

**Act, don't just suggest.** This mode produces files. As each thing becomes clear, write it
(see *Crystallize as you go*). Writing into the model directory is local and reversible.

### The shape of the work: verbs first, then the nouns they need

A business is most naturally described by what it *does*. So lead with the verbs:

1. **Find the verbs.** Draw out what the business does — the processes. ("Walk me through what
   happens, start to finish.") Each is an action: *take an order*, *collect payment*, *ship
   goods*.
2. **Derive the nouns.** For each verb, ask what must exist for that action to be possible — the
   things it reads and the things it produces. Those are your entities and stores. (A user who
   says "we collect payment" implies a payment, a payment method, a payer — surface them by
   asking what the action touches.)
3. **Write the nouns first, then the verbs.** Author the entities (run the entity steps in
   `references/entity-flow.md`), *then* author the flows that reference them (run the flow steps
   in `references/dfd-authoring.md`). A flow's `db:` data-labels point at entity columns, so the
   entities must exist first.

### The five gates

Run every thing the user names — every process, entity, and store — through these five gates
before it goes into the model: **Identify → Decide → Justify → Derive → Ground.** Each gate is a
question you ask in plain language; the rigorous principle behind it stays internal.

**How the gates mesh with the verb-led shape:** walk the verbs first (shape step 1); each
verb's Gate 4 emits candidate nouns; run each noun through the gates as it surfaces, then
return to the next verb. You are not sweeping all five gates over all things in sequence —
you are gating each thing at the moment it appears.

**A gate passes silently when the user has already settled it.** If something the user said —
in their opening description or an earlier answer — answers a gate, take the answer and move
on; ask only the gates still open. ("A booking is always tied to one member and one session"
has already passed Gates 1, 2, and 4 for Booking.) Never re-ask a settled gate. The gates are
a checklist you verify, not a script you recite — a thorough user might pass all five for a
thing in one breath, and the right response is to write the file, not to interrogate.

**Gate 1 — Identify: name it precisely (one name, one thing).**
Pin down exactly what the thing is and where its edges are. Catch two traps: one name covering
two different things, and two names covering one thing.
> "When you say *order*, do you mean the request the customer sends, or the record you keep?
> Same thing, or two different things?"

The classic split this catches: the *Customer* who places an order (an actor outside the system)
versus the *[[Party]]* record that stores who they are (a thing inside it). One word, two things —
separate them.

**Gate 2 — Decide: force the maybe to a yes or no.**
Whenever the user hedges — "sometimes", "it can be", "usually" — resolve it to a binary. A field
that is *sometimes* there is not one thing that is *maybe* present; it is two cases. Make the
user choose which.
> "Is a shipping address always there, or only on some orders? If only some, that's either a
> different kind of order or an optional link — which one?"

This is why a value is either required or optional, never "maybe": a column that "might or might
not" hold a value forces every downstream reader to handle a third, in-between state. Decide it
now, at the model, instead of leaking the uncertainty into every query.

**Gate 3 — Justify: state why it exists.**
Nothing enters the model without a reason that survives being said out loud. If the user can't
say why a thing exists — what question it answers that nothing else already answers — it doesn't
go in, or it's really part of something else.
> "Why does this exist? What does it tell you that nothing else already does?"

The answer is not throwaway — it *is* the business context that fills the bodies: the entity's
purpose, the external's role, the store's reason for being. Capture it in the file as you get it.

**Gate 4 — Derive: find what the verb requires.**
This is the generative engine. Take an action the user described and work backward to the things
it needs:
> "You said you collect payment. For that to happen, what has to already exist — what do you
> read? And what does it produce — what gets written down?"

Read produces the input stores; written produces the output stores. Run this on every process
and the entity list assembles itself. For each thing it surfaces, loop back to Gate 1.

**Gate 5 — Ground: show three real ones.**
A definition isn't real until it produces concrete instances. Ask for three actual examples. If
the user can't produce them, the thing isn't yet well defined — go back to Gate 1.
> "Give me three real ones — actual values you'd see in this."

These instances are not just a test: they become the **examples** in the model — the entity's
sample rows and the flow's in/out example data. Eliciting them here is how every flow ends up
with examples without it ever being a separate chore. **Carry them into the files:** when you
run the entity steps, the Gate-5 instances *are* the Step E7b `examples:` rows — seed E7b from
them rather than generating fresh rows; the same instances seed the flow's `examples:` at
Step F6. One set of real instances, used everywhere.

### Crystallize as you go

Write files incrementally, not in one batch at the end. The moment a thing has passed all five
gates — named precisely, every maybe resolved, its reason stated, its required pieces found, and
three real instances in hand — write its file:

- A thing that persists as a business record → an **entity** file (entity steps).
- An actor outside the system → an **external** file.
- A non-record resting place (log, queue, cache) → a **store** file.
- An action → a **process** file, written after the entities it touches exist.

A half-finished discovery still leaves real, valid files on disk. After writing each batch, run
the verification loop in `references/verification.md`; flow findings are `flow.*` rules, entity
findings the `entity.*`/`edge.*` rules.

### Settling and stopping

- When the user commits to a definition ("yes, that's it"), acknowledge it, write it, move on.
  Don't re-interrogate a thing that's settled unless something later contradicts it.
- If two things the user said can't both be true, surface it right away and ask which holds.
- The session ends when the business is mapped to the user's satisfaction, or they say to stop.
  Whatever has passed the gates is already written; nothing is lost.

<constraints>

### Internal only — never surface any of this to the user

The thinking tools below route your questions. Their names are for you, not the user. Translate
every one into a plain question about the user's business (see *How you talk*).

- **Gate 1** is the law of identity (a thing is itself; one name, one thing).
- **Gate 2** is the excluded middle and non-contradiction — a "nullable / maybe-present" value
  is three-valued logic (true / false / neither); refuse the middle and force a binary.
- **Gate 3** is the law of sufficient reason — nothing exists without a reason.
- **Gate 4** is causality / the four causes — reason backward from an effect (the process) to
  what must exist for it (its material, its trigger, its purpose).
- **Gate 5** is grounding a definition in evidence.

**Banned from anything the user reads** (these may appear only here, in this internal section):
"excluded middle", "law of identity", "non-contradiction", "sufficient reason", "four causes",
"three-valued logic", "falsifiable", "syllogism", "a priori", "ontology". If one of these is the
clearest word for what you mean, you are talking to yourself, not the user — rewrite it as a
plain question.

</constraints>

---
