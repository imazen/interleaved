/**
 * Infer Field[] definitions from frontmatter samples.
 *
 * Given an array of parsed frontmatter objects (from multiple markdown files
 * in the same collection), produces a union of all observed keys with
 * best-guess types. This powers schemaless editing — no .pages.yml required.
 */

import type { Field } from "@/types/field";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;
const URL_RE = /^https?:\/\//;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?)$/i;

type ValueType = "string" | "text" | "number" | "boolean" | "date" | "image" | "select" | "object" | "rich-text";

/** Infer the field type from a single non-null, non-undefined JS value. */
function inferValueType(value: unknown): ValueType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";

  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) return "date";
    if (IMAGE_EXT_RE.test(value) || (URL_RE.test(value) && IMAGE_EXT_RE.test(value))) return "image";
    if (value.length > 200) return "text";
    return "string";
  }

  if (value instanceof Date) return "date";

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return "object";
  }

  return "string";
}

/** Given a key name, try to guess the type from naming conventions. */
function inferTypeFromName(name: string): ValueType | null {
  const lower = name.toLowerCase();
  if (lower === "date" || lower === "published" || lower === "created" || lower === "updated" || lower.endsWith("_at") || lower.endsWith("_date")) return "date";
  if (lower === "draft" || lower === "featured" || lower === "published" || lower.startsWith("is_") || lower.startsWith("has_")) return "boolean";
  if (lower === "image" || lower === "thumbnail" || lower === "cover" || lower === "avatar" || lower === "banner" || lower === "og_image" || lower === "hero") return "image";
  if (lower === "description" || lower === "summary" || lower === "excerpt" || lower === "bio") return "text";
  if (lower === "weight" || lower === "order" || lower === "priority" || lower === "sort") return "number";
  return null;
}

/** Merge two type guesses, preferring the more specific one. */
function mergeTypes(a: ValueType, b: ValueType): ValueType {
  if (a === b) return a;
  // If one is string and the other is more specific, use the specific one
  if (a === "string") return b;
  if (b === "string") return a;
  // If both are specific but different, fall back to string
  return "string";
}

/** Label from a field name: "og_image" → "Og image", "publishedAt" → "Published at" */
function labelFromName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Core inference function. Takes an array of parsed frontmatter objects
 * (one per file) and returns a Field[] representing the union of all
 * observed keys with inferred types.
 */
export function inferFieldsFromSamples(samples: Record<string, unknown>[]): Field[] {
  if (samples.length === 0) return [];

  // Collect type observations per key
  const observations = new Map<string, {
    types: ValueType[];
    isList: boolean;
    count: number;
    values: Set<string>;
    nested: Record<string, unknown>[];
  }>();

  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample)) {
      if (key === "body") continue; // body is handled separately as rich-text
      if (value === null || value === undefined) continue;

      let obs = observations.get(key);
      if (!obs) {
        obs = { types: [], isList: false, count: 0, values: new Set(), nested: [] };
        observations.set(key, obs);
      }

      obs.count++;

      if (Array.isArray(value)) {
        obs.isList = true;
        for (const item of value) {
          if (item !== null && item !== undefined) {
            obs.types.push(inferValueType(item));
            if (typeof item === "string") obs.values.add(item);
          }
        }
      } else {
        obs.types.push(inferValueType(value));
        if (typeof value === "string") obs.values.add(value);
        if (typeof value === "object" && value !== null) {
          obs.nested.push(value as Record<string, unknown>);
        }
      }
    }
  }

  const fields: Field[] = [];

  // Sort keys: common frontmatter fields first, then alphabetical
  const priorityKeys = ["title", "description", "date", "draft", "tags", "categories", "author", "image", "slug", "layout", "weight"];
  const sortedKeys = Array.from(observations.keys()).sort((a, b) => {
    const ai = priorityKeys.indexOf(a.toLowerCase());
    const bi = priorityKeys.indexOf(b.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  for (const key of sortedKeys) {
    const obs = observations.get(key)!;

    // Determine the type
    let type: ValueType;
    if (obs.types.length === 0) {
      type = inferTypeFromName(key) || "string";
    } else {
      type = obs.types.reduce((acc, t) => mergeTypes(acc, t));
      // Name-based hints override value-based when values are all plain strings
      const nameHint = inferTypeFromName(key);
      if (nameHint && type === "string") {
        type = nameHint;
      }
    }

    // If an array field has few unique string values across samples, suggest select
    if (obs.isList && type === "string" && obs.values.size > 0 && obs.values.size <= 20) {
      // Tags/categories pattern — keep as string list, not select
      // (select is for when the field itself picks from a fixed set, not when it's a list of freeform tags)
    }

    const field: Field = {
      name: key,
      label: labelFromName(key),
      type,
    };

    if (obs.isList) {
      field.list = true;
    }

    // Recurse for object types
    if (type === "object" && obs.nested.length > 0) {
      field.fields = inferFieldsFromSamples(obs.nested);
    }

    fields.push(field);
  }

  return fields;
}

/**
 * Build a content schema entry for a directory of markdown files.
 * This is the shape expected by normalizeConfig's content array.
 */
export function buildInferredCollectionEntry(
  name: string,
  dirPath: string,
  fields: Field[],
  format: "yaml-frontmatter" | "json" = "yaml-frontmatter",
): Record<string, unknown> {
  return {
    name,
    label: labelFromName(name),
    type: "collection",
    path: dirPath,
    format,
    fields,
    _inferred: true,
  };
}

/**
 * Build a content schema entry for a single data file (JSON, YAML, TOML).
 * Used for files like _data/site.json, config.json, navigation.json.
 */
export function buildInferredFileEntry(
  name: string,
  filePath: string,
  fields: Field[],
  format: "json" | "yaml" | "toml" = "json",
): Record<string, unknown> {
  return {
    name,
    label: labelFromName(name.replace(/\.(json|ya?ml|toml)$/i, "")),
    type: "file",
    path: filePath,
    format,
    fields,
    _inferred: true,
  };
}
