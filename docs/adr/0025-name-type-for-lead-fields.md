# ADR-0025: A Name type for lead fields

- **Status:** Accepted
- **Date:** 2026-11-27
- **Deciders:** Dhruv (wanted a Name option in the lead-field type dropdown, 2026-11-27)

## Context

Anand Rathi's VAPT (2026-11-25) typed HTML and encoded strings as their name, for example `<iframe src="https://www.google.com"></iframe>` and `%253Ch1%253EHTML…`. The lead extractor stored them as the lead's name. Nothing ran (the dashboard and the CSV export escape it), but the lead was junk, and the name is the most important part of a lead.

Lead fields are defined per agent with a type: Text, Number, Yes/No, Date, Email, Phone. A name is a Text field, so the server cannot tell it apart from "Company name" or "Interest", where digits and symbols are normal ("AT&T", "3M").

## The four questions

- **Blast radius:** lead capture for agents that use the new type. Existing fields keep their type, so nothing changes until an operator picks Name.
- **One-way or two-way door:** mostly two-way. Postgres cannot drop an enum value easily, so `NAME` stays in the enum even if we stop using it.
- **Couples us to:** nothing new.
- **Cost of waiting:** junk names keep reaching the dashboard and CSV exports.

## Decision

Add `NAME` to `DataFieldType` ("Name" in the agent editor dropdown, after Text). For a NAME field:

1. The extractor is told the field is the person's own name and to return null for code, HTML, symbols or numbers.
2. The server keeps the value only if it is letters in any script (combining marks included, so Devanagari works), joined by spaces, `.`, `'` or `-`, 2 to 80 characters. Spaces are tidied. Anything else is not stored; the drop is logged with the field key and session, never the value. The rest of the lead is still stored.

## Options rejected

### Detect name fields from the key or label

**Good:** no schema or UI change, and it works for existing agents at once.

**Rejected because:** it guesses. A field keyed `name` could hold something else, and "Company name" must not get the letters-only rule. An explicit type puts the operator in control.

### A hint on the field only

**Good:** no code at all; the operator writes "letters only" in the field's hint.

**Rejected because:** a hint guides the model but does not stop a value. The name is the most important lead field, so it gets a server-side check. The hint stays useful as extra guidance.

### Validate every field type (phone, email, text)

**Good:** catches junk in more fields.

**Rejected because:** the operator asked for names only. Phone fields are sometimes Number fields, and free-text fields legitimately hold symbols.

## Consequences

- Junk is never stored as a Name, for every agent that uses the type. A junk name stored before the check is removed when that chat is re-extracted; leads that are never re-extracted keep it until someone deletes them.
- Each drop writes a `DATA_FIELD_VALUE_REJECTED` event (field key and session, never the value), so false rejections of real names can be counted.
- Existing name fields must be switched to Name once in the agent editor.
- A real name with a digit or a symbol (rare) is not stored.
