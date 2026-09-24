# ADR-0003: Open mode for the widget Shadow DOM

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Dhruv

## Context

The embeddable chat widget renders inside a Shadow DOM attached to a host `<div>` in the customer's page. Since the widget was built it has used `attachShadow({ mode: 'closed' })`. The reasoning recorded in `docs/research-widget-css-isolation.md` was that closed mode returns `null` for `host.shadowRoot`, so host page JavaScript cannot reach the widget internals.

Two facts have since changed the picture.

**1. A client asked us to prove WCAG 2.1 AA compliance.** Anand Rathi forwarded an accessibility audit run against their site. Every automated accessibility tool in common use walks the DOM from the page: axe-core, Lighthouse, WAVE, Accessibility Insights, Siteimprove. All of them can descend into an open shadow root. None of them can descend into a closed one. Against a closed root the widget reports as a single empty `<div>`: no violations, but also no evidence of conformance. When a client's auditor runs their own scan, we cannot show them anything.

**2. Closed mode was never a security boundary here.** The widget script is loaded by the customer's own page and runs in that page's JavaScript realm. Page script that wants the shadow root can take it:

```js
const real = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  const root = real.call(this, { ...init, mode: "open" });
  window.__stolen = root;
  return root;
};
```

That runs before our bundle and defeats closed mode completely. Closed mode stops a curious developer reading the DOM in devtools. It stops nothing that is actually trying.

There is also nothing behind the boundary worth stealing. The widget's session identifier and cached config already live in `localStorage` and `sessionStorage` (`apps/widget/src/services/config-loader.ts`), which host page JS reads freely whatever the shadow mode is. The visible conversation is text the visitor typed into that same page.

Doing nothing means we keep a boundary that blocks our clients' auditors and does not block an attacker.

## The four questions

- **Blast radius:** every widget embed, every tenant. But the change is one word, and the failure mode is visible immediately (widget renders or it does not). The widget already rendered identically under both modes during local testing.
- **One-way or two-way door:** two-way, and cheap. One line, one deploy. The only thing that makes it sticky is if a customer starts depending on reaching into the shadow root from their page. We do not document it as an API and will not support it.
- **Couples us to:** nothing new. No vendor, no licence, no protocol. It removes a coupling if anything, because compliance evidence no longer needs a bespoke tool.
- **Cost of waiting:** we cannot answer an accessibility questionnaire that a paying client has already sent. Every future enterprise client will ask the same question.

## Decision

The widget attaches its shadow root with `mode: 'open'`.

Rules that follow:

- The shadow root is **not** a public API. We do not document it, we do not version it, and internal DOM structure can change in any release. A customer reaching into it is on their own.
- The shadow root is **not** a trust boundary. Do not put anything inside it that the host page must not see. If something must be hidden from the host page, it does not belong in the browser.
- Host page CSS isolation is unaffected. Isolation comes from the shadow boundary and the constructable stylesheets, not from the mode flag. Style encapsulation is identical in open and closed mode.
- Accessibility regressions in the widget are now catchable by ordinary tooling. Run axe or Lighthouse against a page with the widget open before shipping widget UI changes.

## Options rejected

### Keep closed mode, ship a separate audit build

Build a second bundle with `mode: 'open'` for clients who need to run scans.

**Good:** keeps the existing posture untouched for everyone else, and gives the auditor something real to scan. No change to production behaviour for customers who never ask.

**Rejected because:** two bundles means the thing being audited is not the thing being shipped. An auditor is entitled to point that out, and they would be right. It also doubles the release surface for zero security gain, since closed mode is defeatable anyway.

### Keep closed mode, publish our own audit report

Run axe internally against a dev harness and hand clients the report.

**Good:** cheapest option, and we should produce this report regardless. Self-assessment is normal and accepted in vendor security reviews.

**Rejected because:** it does not survive the client running their own scan, which is exactly what happened here. A vendor whose component is invisible to the client's tooling looks like a vendor with something to hide.

**Revisit if:** never as a substitute, but we should still keep an internal axe run in CI as a regression gate.

### Move the widget into an iframe

Full isolation, and iframes are traversable by audit tools when same-origin.

**Good:** genuinely stronger isolation than any shadow mode, CSS leakage is zero rather than nearly zero, and `@font-face` works normally instead of needing the light DOM injection we do today.

**Rejected because:** this is a rewrite, not a change. It replaces direct DOM access with `postMessage` plumbing across the whole widget, changes how the launcher overlays the page, and re-opens problems we already solved (viewport handling, iOS keyboard, mobile scroll lock). The cost is enormous and the driver is a compliance question, not an isolation failure.

**Revisit if:** we ever need to run untrusted third-party code inside the widget, or a customer's CSP forbids our approach.

## Consequences

**Better:**

- Clients can run axe, Lighthouse, WAVE or Accessibility Insights against their own site and see the widget's real accessibility tree. Accessibility questionnaires become answerable with the client's own evidence.
- We can now put an automated accessibility check in CI against the real widget, instead of only reasoning about it by reading source.
- Debugging widget issues on a live customer site stops requiring a special build.

**Worse:**

- `document.getElementById('codeweaves-widget-host').shadowRoot` now returns a real root. Host page script can read the visible conversation DOM and, in principle, mutate it. This is a real change in what is _easy_, even though it is no change in what is _possible_. We accept it because the same script could already read the session ID out of `localStorage`.
- Somebody may eventually build against the internal DOM and complain when we change it. The rule above exists so we can say no without ambiguity.

**New work:**

- Add an axe-core run against the widget to CI. Not in this change.
- The old rationale in `docs/research-widget-css-isolation.md` section 3.1 is now stale. It is a research note, not a decision record, so it stays as written. This ADR supersedes its recommendation.

## Open questions

None.
