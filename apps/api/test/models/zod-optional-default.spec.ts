import { readdirSync } from "fs";
import { join, relative } from "path";
import { z } from "zod";
import * as validation from "@repo/validation";

/**
 * Zod 4 applies a `.default()` even when the field is wrapped in `.optional()`
 * (Zod 3 left an omitted optional field out). On a PATCH schema that means an
 * omitted field is reset to its default and the update overwrites saved data,
 * e.g. `allowedDomains: allowedDomainsSchema.optional()` would set
 * `allowedDomains: []` on every agent update. Build PATCH fields from a schema
 * without the default (see packages/validation/src/patch.ts).
 */
type Def = Record<string, unknown>;

/** True when an omitted value would reach a default through these wrappers. */
function unwrapToDefault(schema: z.ZodType): boolean {
  let s: z.ZodType = schema;
  for (;;) {
    if (s instanceof z.ZodDefault || s instanceof z.ZodPrefault) return true;
    const def = s._zod.def as unknown as Def;
    if (
      s instanceof z.ZodOptional ||
      s instanceof z.ZodNullable ||
      s instanceof z.ZodReadonly ||
      s instanceof z.ZodCatch
    ) {
      s = def.innerType as z.ZodType;
    } else if (s instanceof z.ZodPipe) {
      s = def.in as z.ZodType;
    } else {
      return false;
    }
  }
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

// Every exported schema in @repo/validation, src/models and any *.dto.ts, found
// on disk so a new DTO module is covered without editing this list. Schemas
// declared inline in a controller are not exported and are not walked.
const SRC = join(__dirname, "..", "..", "src");

function dtoFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return dtoFiles(path);
    const inModels = relative(SRC, dir) === "models";
    return /\.dto\.ts$/.test(entry.name) ||
      (inModels && entry.name.endsWith(".ts"))
      ? [path]
      : [];
  });
}

const modules: Record<string, Record<string, unknown>> = {
  validation,
  ...Object.fromEntries(
    dtoFiles(SRC).map((file) => [
      relative(SRC, file),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(file) as Record<string, unknown>,
    ]),
  ),
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
  it("finds the DTO modules on disk", () => {
    expect(Object.keys(modules)).toEqual(
      expect.arrayContaining([
        "validation",
        join("models", "agent.dto.ts"),
        join("modules", "whatsapp", "whatsapp-channel.dto.ts"),
      ]),
    );
  });

  it("sees a default through a pipe, nullable, catch or readonly", () => {
    const shapes = [
      z.object({
        a: z
          .string()
          .default("x")
          .transform((s) => s)
          .optional(),
      }),
      z.object({ a: z.string().default("x").nullable().optional() }),
      z.object({ a: z.string().default("x").catch("y").optional() }),
      z.object({ a: z.array(z.string()).default([]).readonly().optional() }),
    ];
    for (const shape of shapes) {
      const found: string[] = [];
      findOptionalDefaults(shape, "probe", new Set(), found);
      expect(found).toEqual(["probe.a"]);
    }
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
