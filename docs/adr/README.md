# Architecture Decision Records

An ADR records a decision we made, why we made it, and what we gave up. It is a note to whoever has to change this later, including us in six months.

An ADR is not a proposal and not documentation of how the code works. It answers one question: **why is it like this?**

## Index

| #                                                | Title                            | Status   | Date       |
| ------------------------------------------------ | -------------------------------- | -------- | ---------- |
| [0001](0001-environments-and-deploy-pipeline.md) | Environments and deploy pipeline | Accepted | 2026-09-16 |
| [0002](0002-production-hosting-and-region.md)    | Production hosting and region    | Accepted | 2026-09-16 |
| [0003](0003-widget-shadow-dom-open-mode.md)      | Widget Shadow DOM open mode      | Accepted | 2026-09-24 |

## When to write one

Write an ADR when the decision is **hard to reverse** OR **spans more than one part of the system**:

- schema or data-model shape
- public API or wire contracts
- adopting, rejecting or dropping a third-party dependency
- auth, tenancy or permission model
- anything with a licence or compliance consequence
- every build-vs-adopt call
- hosting, environments, deploy pipeline

Do **not** write one for reversible local choices: file layout, naming inside a module, which helper to use. Decide those and move on.

## The four questions

Answer these before deciding. They are in the template.

1. **Blast radius.** If this is wrong, what breaks, and who notices? One module, or every tenant?
2. **One-way or two-way door?** Can we undo this next week, or are we married to it? Two-way doors should be decided fast and cheaply.
3. **What does it couple us to?** A vendor, a licence, a data shape, a region, a protocol. Name it.
4. **What does waiting cost?** Sometimes the answer is "nothing", and then we should wait.

When genuinely uncertain, pick the option that is **cheapest to undo**.

## Rules

- Copy `TEMPLATE.md`, number it next in sequence, fill it in.
- **Record the options we rejected and what was genuinely good about them.** An ADR that makes the alternatives look stupid is a justification, not a record. If an option had no upside, it was never a real option.
- **ADRs are immutable.** Changed our mind? Write a new ADR that supersedes the old one, and mark the old one `Superseded by ADR-XXXX`. Never rewrite or delete the original.
- Update the index table above whenever an ADR is added or superseded.
- `Proposed` means the decision is written but not agreed. `Accepted` means we are doing it.

## History

This directory was created on 2026-09-16. Earlier versions of CLAUDE.md referred to ADR-0003 through ADR-0007 for the integrations architecture, but those files do not exist in any branch or commit. They were either never written or lost. Numbering restarts at 0001. If the integrations decisions need recording, write them fresh from the code that exists.
