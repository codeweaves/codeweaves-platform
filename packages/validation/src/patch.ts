/**
 * PATCH schemas: every field optional, and a field the client omitted stays
 * omitted.
 *
 * Zod 4 applies a field's `.default()` even inside `.optional()`, so a plain
 * `.partial()` fills every omitted field with its default, and the merge then
 * overwrites what the client saved (an AI-config PATCH that only changes the
 * model would switch PII redaction and RAG back to their defaults). These
 * helpers drop the field's default before making it optional, which is what
 * Zod 3's `.partial()` and `.deepPartial()` did.
 */
import { z } from "zod";

type AnySchema = z.ZodType;

function withoutDefault(schema: AnySchema): AnySchema {
  let s = schema;
  while (s instanceof z.ZodDefault || s instanceof z.ZodPrefault) {
    s = s.unwrap() as AnySchema;
  }
  return s;
}

/** One level, like Zod 3's `.partial()`. */
export function patchOf<S extends z.ZodObject>(
  schema: S,
): z.ZodObject<{ [K in keyof S["shape"]]: z.ZodOptional<S["shape"][K]> }> {
  const shape: Record<string, AnySchema> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    shape[key] = withoutDefault(field as AnySchema).optional();
  }
  return schema.extend(shape) as never;
}

/**
 * Recursive, like Zod 3's `.deepPartial()`: nested objects and array elements
 * become partial too. A section with its own `.default()` loses only that
 * default; when the client sends it, it is parsed whole, as before.
 */
function deepPatch(schema: AnySchema): AnySchema {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault) {
    return withoutDefault(schema);
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, AnySchema> = {};
    for (const [key, field] of Object.entries(schema.shape)) {
      shape[key] = deepPatch(field as AnySchema).optional();
    }
    return schema.extend(shape);
  }
  if (schema instanceof z.ZodArray) {
    return schema.clone({
      ...schema._zod.def,
      element: deepPatch(schema.element as AnySchema),
    });
  }
  if (schema instanceof z.ZodOptional) {
    return deepPatch(schema.unwrap() as AnySchema).optional();
  }
  if (schema instanceof z.ZodNullable) {
    return deepPatch(schema.unwrap() as AnySchema).nullable();
  }
  return schema;
}

export type DeepPatch<T> = T extends readonly (infer E)[]
  ? DeepPatch<E>[]
  : T extends object
    ? { [K in keyof T]?: DeepPatch<T[K]> }
    : T;

export function deepPatchOf<S extends z.ZodObject>(
  schema: S,
): z.ZodType<DeepPatch<z.output<S>>> {
  return deepPatch(schema) as never;
}
