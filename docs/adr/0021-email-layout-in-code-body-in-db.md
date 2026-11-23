# ADR-0021: Email layout in code, email body in the database

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Dhruv

## Context

We send two transactional emails, a team invitation and a handover alert. Both come from the `email_templates` table. A SUPER_ADMIN edits them in Utilities → Email, and the change takes effect without a deploy.

Each row held a complete small email: its own outer box, font, width and sign-off line. There was no logo, no footer and no shared design. Client onboarding starts the week of 2026-11-16, so every email needs the same logo header and the same footer, with the legal name (Fidevia Technologies, a partnership firm) and a support contact.

If each row carries its own header and footer, every new template must copy them, a dashboard edit can break or delete them, and a footer change means editing every row.

## The four questions

- **Blast radius:** every email we send. If the frame breaks, every invitation and handover alert looks wrong. Unit tests cover the frame and the join.
- **One-way or two-way door:** two-way. Moving the frame back into the rows is one migration.
- **Couples us to:** a data shape. `email_templates.html` now holds only the body, and the web preview depends on the API sending `layout` with the template.
- **Cost of waiting:** clients would get unbranded emails during onboarding.

## Decision

The email is built from two parts:

| Part                                                                           | Where it lives                          | Who changes it                      |
| ------------------------------------------------------------------------------ | --------------------------------------- | ----------------------------------- |
| Frame: page background, logo header (links to the website), white card, footer | `apps/api/src/services/email-layout.ts` | A developer, with a deploy          |
| Subject and body: everything inside the card                                   | `email_templates` rows                  | A SUPER_ADMIN, in Utilities → Email |

Rules:

- `EmailTemplateService.render` joins `before + body + after` by plain concatenation. The body is substituted and escaped first, and the frame is never scanned for `{{variables}}`.
- The editor preview builds the same email. `GET /email-templates/:key` returns `layout: { before, after }`, and the web joins it around the edited body. If `layout` is missing (an older API), the preview shows the body alone.
- Footer content is fixed in code: automated-email notice, support email, legal name, copyright year. Optional fields (address, privacy policy URL) are hidden while empty.
- The logo is served from the dashboard origin (`DASHBOARD_URL` + `/email/klivo-logo.png`). The API logs a warning in production when `DASHBOARD_URL` is not set.
- Migration `20261114000000_email_template_bodies` rewrites the two seeded rows to body-only HTML. It skips rows that have been edited in the dashboard (`updatedBy` set). On 2026-11-14 no row was edited on develop or staging.

## Options rejected

### Keep the full email in each row

**Good:** the template is completely editable from the dashboard, including the header and footer, with no deploy.

**Rejected because:** the shared parts would be copied into every row, and any edit could remove the legal footer. The footer is the part we least want edited by accident.

### Store the layout as its own row in the database

**Good:** the header and footer could change without a deploy, and one row would serve every template.

**Rejected because:** it adds a second editable thing that can break every email at once, it needs its own editor, audit trail and validation, and the footer changes very rarely. **Revisit if** non-developers need to change the footer often.

### Adopt React Email or MJML for the templates

**Good:** proven email-client compatibility, components, and a better authoring experience. React Email is made by the Resend team.

**Rejected because:** the templates are edited at runtime as HTML in the dashboard, which a build-time component library does not support without a new rendering service. Two templates do not justify a new dependency. **Revisit if** we have many templates, or move editing from the dashboard into code.

## Consequences

- Every email gets the same logo header and footer, and new templates get them with no extra work.
- A dashboard edit cannot remove the logo or the footer.
- Changing the footer needs a deploy.
- Under migrate-then-deploy, the migration runs before the new API is live. During that short window, and after a rollback, the old code sends the body without the frame. The email is still readable, but unbranded.
- A row edited before this migration keeps its old outer box and is shown inside the new card. Whoever edits such a row must remove the old wrapper by hand.
- The email logo depends on the dashboard serving `apps/web/public/email/klivo-logo.png`.

## Open questions

- An email that people can reply to (for example a support email) must not show "Please do not reply". When the first one is added, each template gets an "automated" setting in the registry, plus a reply-to address. Decided by: whoever adds that email.
