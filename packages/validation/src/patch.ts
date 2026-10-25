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

/** Removes defaults, also under `.nullable()`, which would still apply one. */
function withoutDefault(schema: AnySchema): AnySchema {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault) {
    return withoutDefault(schema.unwrap() as AnySchema);
  }
  if (schema instanceof z.ZodNullable) {
    return withoutDefault(schema.unwrap() as AnySchema).nullable();
  }
  return schema;
}

type WithoutDefault<T> =
  T extends z.ZodDefault<infer I>
    ? WithoutDefault<I>
    : T extends z.ZodPrefault<infer I>
      ? WithoutDefault<I>
      : T extends z.ZodNullable<infer I>
        ? z.ZodNullable<WithoutDefault<I>>
        : T;

/** One level, like Zod 3's `.partial()`. */
export function patchOf<
  Shape extends z.ZodRawShape,
  Config extends z.core.$ZodObjectConfig,
>(
  schema: z.ZodObject<Shape, Config>,
): z.ZodObject<
  { [K in keyof Shape]: z.ZodOptional<WithoutDefault<Shape[K]>> },
  Config
> {
  const shape: Record<string, AnySchema> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    shape[key] = withoutDefault(field as AnySchema).optional();
  }
  return schema.extend(shape) as never;
}

/**
 * Recursive: every nested object field becomes optional, defaults included,
 * so a PATCH of one field in a section (even a defaulted one such as theme
 * `handover`) carries only that field and the merge keeps the rest. Arrays
 * are not made partial: the merge replaces an array whole, so each element
 * must be valid on its own.
 */
function deepPatch(schema: AnySchema): AnySchema {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault) {
    return deepPatch(withoutDefault(schema));
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, AnySchema> = {};
    for (const [key, field] of Object.entries(schema.shape)) {
      shape[key] = deepPatch(field as AnySchema).optional();
    }
    return schema.extend(shape);
  }
  if (schema instanceof z.ZodOptional) {
    return deepPatch(schema.unwrap() as AnySchema).optional();
  }
  if (schema instanceof z.ZodNullable) {
    return deepPatch(schema.unwrap() as AnySchema).nullable();
  }
  return schema;
}

export type DeepPatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPatch<T[K]> }
    : T;

export function deepPatchOf<S extends z.ZodObject>(
  schema: S,
): z.ZodType<DeepPatch<z.output<S>>> {
  return deepPatch(schema) as never;
}
