import { z } from "zod";
import * as validation from "@repo/validation";
import * as agentDto from "../../src/models/agent.dto";
import * as agentThemeDto from "../../src/models/agent-theme.dto";
import * as analyticsDto from "../../src/models/analytics.dto";
import * as conversationsDto from "../../src/models/conversations.dto";
import * as emailTemplateDto from "../../src/models/email-template.dto";
import * as handoverDto from "../../src/models/handover.dto";
import * as invitationDto from "../../src/models/invitation.dto";
import * as notificationDto from "../../src/models/notification.dto";
import * as organizationDto from "../../src/models/organization.dto";
import * as rbacDto from "../../src/models/rbac.dto";
import * as usageDto from "../../src/models/usage.dto";
import * as userDto from "../../src/models/user.dto";
import * as whatsappDto from "../../src/modules/whatsapp/whatsapp-channel.dto";

/**
 * Zod 4 applies a `.default()` even when the field is wrapped in `.optional()`
 * (Zod 3 left an omitted optional field out). On a PATCH schema that means an
 * omitted field is reset to its default and the update overwrites saved data,
 * e.g. `allowedDomains: allowedDomainsSchema.optional()` would set
 * `allowedDomains: []` on every agent update. Build PATCH fields from a schema
 * without the default (see packages/validation/src/patch.ts).
 */
type Def = Record<string, unknown>;

function unwrapToDefault(schema: z.ZodType): boolean {
  let s: z.ZodType = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    s = s.unwrap() as z.ZodType;
  }
  return s instanceof z.ZodDefault || s instanceof z.ZodPrefault;
}

function findOptionalDefaults(
  schema: unknown,
  path: string,
  seen: Set<unknown>,
  out: string[],
): void {
  if (!(schema instanceof z.ZodType) || seen.has(schema)) return;
  seen.add(schema);
  if (
    schema instanceof z.ZodOptional &&
    unwrapToDefault(schema.unwrap() as z.ZodType)
  ) {
    out.push(path);
  }
  const def = schema._zod.def as unknown as Def;
  if (schema instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(schema.shape)) {
      findOptionalDefaults(field, `${path}.${key}`, seen, out);
    }
  }
  for (const key of [
    "innerType",
    "element",
    "in",
    "out",
    "left",
    "right",
    "valueType",
  ]) {
    findOptionalDefaults(def[key], path, seen, out);
  }
  for (const key of ["options", "items"]) {
    const list = def[key];
    if (Array.isArray(list))
      list.forEach((s, i) =>
        findOptionalDefaults(s, `${path}[${i}]`, seen, out),
      );
  }
}

const modules: Record<string, Record<string, unknown>> = {
  validation,
  agentDto,
  agentThemeDto,
  analyticsDto,
  conversationsDto,
  emailTemplateDto,
  handoverDto,
  invitationDto,
  notificationDto,
  organizationDto,
  rbacDto,
  usageDto,
  userDto,
  whatsappDto,
};

describe("PATCH schemas keep omitted fields omitted", () => {
  it("agent update: renaming does not reset list fields to []", () => {
    expect(validation.updateAgentSchema.parse({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
  });

  it("AI-config PATCH: changing the model does not reset other settings", () => {
    expect(
      validation.agentAiConfigUpdateSchema.parse({
        modelId: "openai:gpt-4.1-mini",
      }),
    ).toEqual({
      modelId: "openai:gpt-4.1-mini",
    });
  });

  it("theme PATCH: one consent field does not fill the other consent fields", () => {
    expect(
      validation.partialWidgetThemeSchema.parse({ consent: { enabled: true } }),
    ).toEqual({
      consent: { enabled: true },
    });
  });

  it("theme PATCH: an empty patch stays empty", () => {
    expect(validation.partialWidgetThemeSchema.parse({})).toEqual({});
  });

  it("theme read: a stored theme without consent gets every consent default", () => {
    const stored: Record<string, unknown> = {
      ...validation.defaultWidgetTheme,
    };
    delete stored.consent;
    const consent = validation.widgetThemeSchema.parse(stored).consent;
    expect(consent).toEqual(validation.consentConfigSchema.parse({}));
    expect(consent.buttonLabel).toBe("Start chat");
  });

  it("IDs: any hex 8-4-4-4-12 id is accepted, as before", () => {
    expect(
      z.guid().safeParse("11111111-1111-1111-1111-111111111111").success,
    ).toBe(true);
  });
});

describe("Zod schemas: no default inside an optional field", () => {
  it("walks at least the core schemas", () => {
    expect(validation.updateAgentSchema).toBeInstanceOf(z.ZodType);
  });

  it("has no optional field whose omission would be replaced by a default", () => {
    const found: string[] = [];
    const seen = new Set<unknown>();
    for (const [moduleName, exports] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(exports)) {
        findOptionalDefaults(value, `${moduleName}.${name}`, seen, found);
      }
    }
    expect(found).toEqual([]);
  });
});
