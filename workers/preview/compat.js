/**
 * Handlebars → Mustache compatibility preprocessor.
 *
 * Cloudflare Workers block `new Function` / `eval`, which Handlebars
 * uses to compile templates. Mustache is pure string parsing and works.
 * But the default Interleaved template uses Handlebars syntax.
 *
 * This preprocessor rewrites the most common Handlebars constructs
 * into equivalent Mustache syntax, so users can write templates that
 * work in both the worker preview and the Node build script.
 *
 * Supported rewrites:
 *   {{#if var}}...{{/if}}                  → {{#var}}...{{/var}}
 *   {{#if var}}a{{else}}b{{/if}}            → {{#var}}a{{/var}}{{^var}}b{{/var}}
 *   {{#unless var}}...{{/unless}}           → {{^var}}...{{/var}}
 *   {{#each arr}}...{{/each}}               → {{#arr}}...{{/arr}}
 *   {{formatDate x}}                        → {{x_formatted}}
 *   {{truncate x N}}                        → {{x_truncated}}
 *   {{#each (sortBy posts "date" "desc")}}  → {{#posts}} (already sorted by renderer)
 *   {{> partialName}}                       → {{> partialName}} (identical)
 *
 * Not supported — must be rewritten by hand:
 *   Custom helpers beyond formatDate/truncate
 *   Subexpressions other than sortBy
 *   {{#with}} blocks
 */

export function handlebarsToMustache(source) {
  let result = source;

  // {{#if var}}X{{else}}Y{{/if}} → {{#var}}X{{/var}}{{^var}}Y{{/var}}
  // Must handle this BEFORE the simple {{#if}} replacement.
  result = result.replace(
    /\{\{#if\s+([^}]+?)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, expr, ifBody, elseBody) => {
      const v = expr.trim();
      return `{{#${v}}}${ifBody}{{/${v}}}{{^${v}}}${elseBody}{{/${v}}}`;
    },
  );

  // {{#if var}}X{{/if}} → {{#var}}X{{/var}}
  result = result.replace(
    /\{\{#if\s+([^}]+?)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, expr, body) => {
      const v = expr.trim();
      return `{{#${v}}}${body}{{/${v}}}`;
    },
  );

  // {{#unless var}}X{{/unless}} → {{^var}}X{{/var}}
  result = result.replace(
    /\{\{#unless\s+([^}]+?)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_, expr, body) => {
      const v = expr.trim();
      return `{{^${v}}}${body}{{/${v}}}`;
    },
  );

  // {{#each (sortBy posts "field" "order")}} → {{#posts}} — renderer pre-sorts
  result = result.replace(
    /\{\{#each\s+\(sortBy\s+([^\s)]+)[^)]*\)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, collection, body) => {
      const v = collection.trim();
      return `{{#${v}}}${body}{{/${v}}}`;
    },
  );

  // {{#each arr}}X{{/each}} → {{#arr}}X{{/arr}}
  result = result.replace(
    /\{\{#each\s+([^}]+?)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, expr, body) => {
      const v = expr.trim();
      return `{{#${v}}}${body}{{/${v}}}`;
    },
  );

  // Inside {{#each}} blocks, {{this.foo}} works natively in both engines.
  // But Mustache uses the current item as the context, so {{this.foo}} and
  // {{foo}} both work.

  // {{formatDate date}} → {{date_formatted}} (renderer pre-computes)
  result = result.replace(
    /\{\{formatDate\s+([^\s}]+)[^}]*\}\}/g,
    (_, field) => `{{${field.trim().replace(/^this\./, "")}_formatted}}`,
  );

  // {{truncate description 120}} → {{description_truncated}}
  result = result.replace(
    /\{\{truncate\s+([^\s}]+)[^}]*\}\}/g,
    (_, field) => `{{${field.trim().replace(/^this\./, "")}_truncated}}`,
  );

  return result;
}
