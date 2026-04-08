/**
 * The Zod schema for the configuration file. Used in the settings editor.
 *
 * Look at the `lib/config.ts` file to understand how we use this schema.
 */

import { z } from "zod";
import { fieldTypes } from "@/fields/registry";

const ActionSchema = z
  .object({
    name: z
      .string({
        error: (issue) => issue.input === undefined
          ? "'name' is required."
          : "'name' must be a string.",
      })
      .regex(/^[a-zA-Z0-9-_]+$/, {
        error: "'name' must be alphanumeric with dashes and underscores.",
      }),
    label: z.string({
      error: (issue) => issue.input === undefined
        ? "'label' is required."
        : "'label' must be a string.",
    }),
    workflow: z.string({
      error: (issue) => issue.input === undefined
        ? "'workflow' is required."
        : "'workflow' must be a string.",
    }),
    ref: z
      .string({
        error: "'ref' must be a string.",
      })
      .optional(),
    cancelable: z
      .boolean({
        error: "'cancelable' must be a boolean.",
      })
      .optional(),
    scope: z
      .enum(["collection", "entry"], {
        error: "'scope' must be either 'collection' or 'entry'.",
      })
      .optional(),
    confirm: z
      .union([
        z.boolean({
          error: "'confirm' must be a boolean or an object.",
        }),
        z.object({
          title: z.string().optional(),
          message: z.string().optional(),
          button: z.string().optional(),
        }).strict(),
      ])
      .optional(),
    fields: z
      .array(z.object({
        name: z
          .string({
            error: (issue) => issue.input === undefined
              ? "'fields[].name' is required."
              : "'fields[].name' must be a string.",
          })
          .regex(/^[a-zA-Z0-9-_]+$/, {
            error: "'fields[].name' must be alphanumeric with dashes and underscores.",
          }),
        label: z.string({
          error: (issue) => issue.input === undefined
            ? "'fields[].label' is required."
            : "'fields[].label' must be a string.",
        }),
        type: z.enum(["text", "textarea", "select", "checkbox", "number"], {
          error: "'fields[].type' must be 'text', 'textarea', 'select', 'checkbox', or 'number'.",
        }),
        required: z.boolean().optional(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        options: z.array(z.object({
          label: z.string(),
          value: z.string(),
        }).strict()).optional(),
      }).strict().superRefine((field, ctx) => {
        if (field.type === "select" && (!field.options || field.options.length === 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "'fields[].options' is required for select fields.",
            path: ["options"],
          });
        }
        if (field.type !== "select" && field.options) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "'fields[].options' is only allowed for select fields.",
            path: ["options"],
          });
        }
      }), {
        error: "'fields' must be an array of action field definitions.",
      })
      .optional(),
  })
  .strict();

const CommitTemplatesSchema = z
  .object({
    create: z
      .string({
        error: "'create' must be a string.",
      })
      .optional(),
    update: z
      .string({
        error: "'update' must be a string.",
      })
      .optional(),
    delete: z
      .string({
        error: "'delete' must be a string.",
      })
      .optional(),
    rename: z
      .string({
        error: "'rename' must be a string.",
      })
      .optional(),
  })
  .strict();

const CommitIdentitySchema = z.enum(["app", "user"], {
  error: "'identity' must be either 'app' or 'user'.",
});

// Media configuration object schema (for single object)
const MediaConfigObject = z
  .object({
    input: z
      .string({
        error: "'input' is required.",
      })
      .regex(/^[^/].*[^/]$|^$/, {
        error:
          "'input' must be a valid relative path (no leading or trailing slash).",
      }),
    output: z
      .string({
        error: "'output' is required.",
      })
      .regex(/^(\/?[^/].*[^/]$|^\/?$)/, {
        error: "'output' must be a valid path with no trailing slash.",
      }),
    path: z
      .string()
      .regex(/^[^/].*[^/]$|^$/, {
        error:
          "'path' must be a valid relative path (no leading or trailing slash).",
      })
      .optional(),
    extensions: z
      .array(
        z.string({
          error: "Entries in the 'extensions' array must be strings.",
        }),
        {
          error: "'extensions' must be an array of strings.",
        },
      )
      .optional(),
    categories: z
      .array(
        z.enum(
          [
            "image",
            "document",
            "video",
            "audio",
            "compressed",
            "code",
            "font",
            "spreadsheet",
          ],
          {
            error:
              "Entries in the 'categories' array must be 'image', 'document', 'video', 'audio', 'compressed', 'code', 'font', or 'spreadsheet'.",
          },
        ),
        {
          error: "'categories' must be an array of strings.",
        },
      )
      .optional(),
    rename: z
      .union([
        z.boolean({
          error: "'rename' must be a boolean, 'safe', or 'random'.",
        }),
        z.enum(["safe", "random"], {
          error: "'rename' must be a boolean, 'safe', or 'random'.",
        }),
      ])
      .optional(),
    commit: z
      .object(
        {
          templates: CommitTemplatesSchema.optional(),
          identity: CommitIdentitySchema.optional(),
        },
        {
          error: "'commit' must be an object.",
        },
      )
      .optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    actions: z
      .array(ActionSchema, {
        error: "'actions' must be an array of action definitions.",
      })
      .optional(),
  })
  .strict();

// Named media configuration schema (for array entries)
const NamedMediaConfig = MediaConfigObject.extend({
  name: z.string({
    error: (issue) => issue.input === undefined
      ? "'name' is required for media configurations in array format."
      : "'name' must be a string.",
  }),
});

// Media schema
const MediaSchema = z.union([
  z.string().regex(/^[^/].*[^/]$|^$/, {
    error:
      "'media' must be a valid relative path (no leading or trailing slash).",
  }),
  MediaConfigObject,
  z.array(NamedMediaConfig, {
    error:
      "'media' must be a string, an object, or an array of named media configurations.",
  }),
]);

// Schema for list attribute (used in both field and content entries)
const ListSchema = z.union([
  z.boolean(),
  z
    .object(
      {
        min: z
          .number()
          .min(0, "'min' must be a positive integer (minimum 0).")
          .optional(),
        max: z
          .number()
          .min(1, "'max' must be a positive integer (minimum 1).")
          .optional(),
        collapsible: z.union([
          z.boolean(),
          z.object(
            {
              collapsed: z.boolean().optional(),
              summary: z.string().optional(),
            },
            {
              error:
                "'collapsible' must be either a boolean or an object with 'collapsed' and 'summary' properties.",
            },
          ),
        ]),
      },
      {
        error:
          "'list' must be either a boolean or an object with 'min' and 'max' properties.",
      },
    )
    .strict(),
]);

const FilenameConfigSchema = z.union([
  z.string({
    error: "'filename' must be a string or an object.",
  }),
  z
    .object(
      {
        template: z.string({
          error: (issue) => issue.input === undefined
            ? "'template' is required."
            : "'template' must be a string.",
        }),
        field: z
          .union([
            z.boolean({
              error: "'field' must be a boolean or 'create'.",
            }),
            z.enum(["create"], {
              error: "'field' must be a boolean or 'create'.",
            }),
          ])
          .optional(),
      },
      {
        error:
          "'filename' object must contain 'template' and optionally 'field'.",
      },
    )
    .strict(),
]);

// Generator for Field Object Schema (components do not have a `name` field)
const generateFieldObjectSchema = (
  isComponent?: boolean,
  isBlock?: boolean,
): z.ZodType<any> => {
  let baseObjectSchema = {
    label: z
      .union([
        z.literal(false),
        z.string({
          error: "'label' must be a string or 'false'.",
        }),
      ])
      .optional(),
    description: z.string().optional().nullable(),
    component: z
      .string({
        error: "'component' must be a string.",
      })
      .regex(/^[a-zA-Z0-9-_]+$/, {
        error:
          "Component key must be alphanumeric with dashes and underscores.",
      })
      .optional(),
    default: z.any().nullable().optional(),
    fields: z
      .array(
        z.lazy(() => generateFieldObjectSchema()),
        { error: "'fields' must be an array of field definitions." },
      )
      .optional(),
  };

  if (!isComponent) {
    baseObjectSchema = {
      ...{
        name: z
          .string({
            error: (issue) => issue.input === undefined
              ? "'name' is required."
              : "'name' must be a string.",
          })
          .regex(/^[a-zA-Z0-9-_]+$/, {
            error: "'name' must be alphanumeric with dashes and underscores.",
          }),
      },
      ...baseObjectSchema,
    };
  }

  if (!isBlock) {
    baseObjectSchema = {
      ...{
        type: z
          .string({
            error: "'type' must be a string.",
          })
          .min(1, { error: "'type' cannot be empty." })
          .refine(
            (val) => fieldTypes.has(val) || ["object", "block"].includes(val),
            {
              error: "'type' must be a valid field type.",
              path: ["type"],
            },
          )
          .optional(),
        list: ListSchema.optional(),
        hidden: z
          .boolean({
            error: "'hidden' must be a boolean.",
          })
          .optional()
          .nullable(),
        readonly: z
          .boolean({
            error: "'readonly' must be a boolean.",
          })
          .optional()
          .nullable(),
        required: z
          .boolean({
            error: "'required' must be a boolean.",
          })
          .optional()
          .nullable(),
        pattern: z
          .union([
            z.string({
              error: "'pattern' must be a valid regex string.",
            }),
            z
              .object(
                {
                  regex: z.string({
                    error: (issue) => issue.input === undefined
                      ? "'regex' is required."
                      : "'regex' must be a valid regex string.",
                  }),
                  message: z
                    .string({
                      error: "'message' must be a string.",
                    })
                    .optional(),
                },
                {
                  error:
                    "'pattern' must be a string (regex) or an object with 'regex' and optionally 'message' properties.",
                },
              )
              .strict(),
          ])
          .optional(),
        options: z.object({}).optional().nullable(),
        blocks: z
          .array(
            z.lazy(() => generateFieldObjectSchema(false, true)),
            { error: "'blocks' must be an array of field definitions." },
          )
          .optional(),
        blockKey: z
          .string({
            error: "'blockKey' must be a string.",
          })
          .min(1, {
            error: "'blockKey' cannot be empty.",
          })
          .optional(),
      },
      ...baseObjectSchema,
    };
  }

  return z.lazy(() =>
    z
      .object(baseObjectSchema)
      .strict()
      .superRefine((data: any, ctx: any) => {
        if (!isBlock) {
          const hasType = data.type !== undefined;
          const hasComponent = data.component !== undefined;
          if (hasType === hasComponent) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Field must have exactly one of 'type' or 'component'.",
              path: ["type", "component"],
            });
          }
        }

        if (data.type === "block" && data.blocks === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Fields with type 'block' must have a 'blocks' attribute.",
            path: ["blocks"],
          });
        }

        if (data.type === "object" && data.fields === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Fields with type 'object' must have a 'fields' attribute.",
            path: ["fields"],
          });
        }

        if (
          isBlock &&
          data.fields === undefined &&
          data.component === undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Blocks must have a 'fields' attribute or inherit one from a component.",
            path: ["fields", "component"],
          });
        }

        if (data.blockKey !== undefined && data.type !== "block") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "'blockKey' attribute is only valid when 'type' is 'block'.",
            path: ["blockKey"],
          });
        }
      }),
  );
};

const ContentLeafSchema = z
  .object({
    name: z
      .string({
        error: (issue) => issue.input === undefined
          ? "'name' is required."
          : "'name' must be a string.",
      })
      .regex(/^[a-zA-Z0-9-_]+$/, {
        error: "'name' must be alphanumeric with dashes and underscores.",
      }),
    label: z.string().optional(),
    description: z.string().optional().nullable(),
    type: z.enum(["collection", "file"], {
      error: (issue) => issue.input === undefined
        ? "'type' is required."
        : "'type' must be either 'collection' or 'file'.",
    }),
    path: z
      .string({
        error: (issue) => issue.input === undefined
          ? "'path' is required."
          : "'path' must be a string.",
      })
      .regex(/^[^/].*[^/]$|^$/, {
        error:
          "'path' must be a valid relative path (no leading or trailing slash).",
      }),
    filename: FilenameConfigSchema.optional().nullable(),
    exclude: z
      .array(
        z.string({
          error: "Entries in the 'exclude' array must be strings.",
        }),
        {
          error: "'exclude' must be an array of strings.",
        },
      )
      .optional(),
    view: z
      .object(
        {
          layout: z
            .enum(["tree", "list"], {
              error: "'layout' must be either 'tree' or 'list'.",
            })
            .optional(),
          node: z
            .union(
              [
                z.object(
                  {
                    filename: z.string({
                      error: (issue) => issue.input === undefined
                        ? "'filename' is required."
                        : "'filename' must be a string.",
                    }),
                    hideDirs: z
                      .enum(["all", "nodes", "others"], {
                        error:
                          "'hideDirs' must be one of 'nodes', 'others', or 'all'.",
                      })
                      .optional(),
                  },
                  {
                    error:
                      "'node' must contain 'filename' and optionally 'hideDirs'.",
                  },
                ),
                z.string({
                  error:
                    "'node' must be a string or an object with 'filename' and optionally 'hideDirs' attributes.",
                }),
              ],
              {
                error:
                  "'node' must be a string or an object with 'filename' and 'hideDirs'.",
              },
            )
            .optional(),
          fields: z
            .array(
              z.string({
                error: "Entries in the 'fields' array must be strings.",
              }),
              {
                error: "'fields' must be an array of strings.",
              },
            )
            .optional(),
          primary: z
            .string({
              error: "'primary' must be a string.",
            })
            .optional()
            .nullable(),
          sort: z
            .array(
              z.string({
                error: "Entries in the 'sort' array must be strings.",
              }),
              {
                error: "'sort' must be an array of strings.",
              },
            )
            .optional(),
          search: z
            .array(
              z.string({
                error: "Entries in the 'search' array must be strings.",
              }),
              {
                error: "'search' must be an array of strings.",
              },
            )
            .optional(),
          default: z
            .object(
              {
                search: z
                  .string({
                    error: "'search' must be a string.",
                  })
                  .optional()
                  .nullable(),
                sort: z
                  .string({
                    error: "'sort' must be a string.",
                  })
                  .optional()
                  .nullable(),
                order: z
                  .enum(["asc", "desc"], {
                    error: "'order' must be either 'asc' or 'desc'.",
                  })
                  .optional()
                  .nullable(),
              },
              {
                error:
                  "'default' must be an object with 'search', 'sort' and 'order' attributes.",
              },
            )
            .strict()
            .optional()
            .nullable(),
        },
        {
          error:
            "'view' must be an object with 'fields', 'primary', 'sort', 'search' and 'default' attributes.",
        },
      )
      .strict()
      .optional()
      .nullable(),
    format: z
      .enum(
        [
          "yaml-frontmatter",
          "json-frontmatter",
          "toml-frontmatter",
          "yaml",
          "json",
          "toml",
          "datagrid",
          "code",
          "raw",
        ],
        {
          error:
            "'format' must be 'yaml-frontmatter', 'json-frontmatter', 'tom-frontmatter', 'yaml', 'json', 'toml', 'datagrid', 'code' or 'raw'.",
        },
      )
      .optional()
      .nullable(),
    delimiters: z
      .union([
        z
          .array(
            z.string({
              error: "Delimiters must be strings",
            }),
          )
          .length(2, "'delimiters' must contain exactly two string values."),
        z.string({
          error: "'delimiters' must be a string or array of 2 strings.",
        }),
      ])
      .optional(),
    subfolders: z
      .boolean({
        error: "'subfolders' must be a boolean.",
      })
      .optional()
      .nullable(),
    fields: z
      .array(generateFieldObjectSchema(), {
        error: "'fields' must be an array of field definitions.",
      })
      .optional(),
    list: ListSchema.optional(),
    commit: z
      .object(
        {
          templates: CommitTemplatesSchema.optional(),
          identity: CommitIdentitySchema.optional(),
        },
        {
          error: "'commit' must be an object.",
        },
      )
      .optional(),
    actions: z
      .array(ActionSchema, {
        error: "'actions' must be an array of action definitions.",
      })
      .optional(),
  })
  .strict();

const ContentGroupSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      name: z
        .string({
          error: (issue) => issue.input === undefined
            ? "'name' is required."
            : "'name' must be a string.",
        })
        .regex(/^[a-zA-Z0-9-_]+$/, {
          error: "'name' must be alphanumeric with dashes and underscores.",
        }),
      label: z.string().optional(),
      description: z.string().optional().nullable(),
      type: z.literal("group", {
        error: "'type' must be 'group'.",
      }),
      items: z.array(ContentObjectSchema, {
        error: "'items' must be an array of content entries.",
      }),
    })
    .strict(),
);

const ContentObjectSchema: z.ZodType<any> = z.lazy(() =>
  z.union([ContentLeafSchema, ContentGroupSchema]),
);

// Main schema with media and content
const ConfigSchema = z
  .object({
    cache: z
      .boolean({
        error: "'cache' must be a boolean.",
      })
      .optional(),
    hide: z
      .boolean({
        error: "'hide' must be a boolean.",
      })
      .optional(),
    media: MediaSchema.optional(),
    content: z
      .array(ContentObjectSchema, {
        error:
          "'content' must be an array of objects with at least one entry.",
      })
      .optional(),
    components: z
      .record(
        z.string().regex(/^[a-zA-Z0-9-_]+$/, {
          error:
            "Component key must be alphanumeric with dashes and underscores.",
        }),
        generateFieldObjectSchema(true),
      )
      .optional(),
    actions: z
      .array(ActionSchema, {
        error: "'actions' must be an array of action definitions.",
      })
      .optional(),
    settings: z
      .union([
        z
          .object(
            {
              config: z
                .boolean({
                  error: "'config' must be a boolean.",
                })
                .optional(),
              cache: z
                .boolean({
                  error: "'cache' must be a boolean.",
                })
                .optional(),
              hide: z
                .boolean({
                  error: "'hide' must be a boolean.",
                })
                .optional(),
              content: z
                .object(
                  {
                    merge: z
                      .boolean({
                        error: "'merge' must be a boolean.",
                      })
                      .optional(),
                  },
                  {
                    error: "'content' must be an object.",
                  },
                )
                .optional(),
              commit: z
                .object(
                  {
                    templates: CommitTemplatesSchema.optional(),
                    identity: CommitIdentitySchema.optional(),
                  },
                  {
                    error: "'commit' must be an object.",
                  },
                )
                .optional(),
            },
            {
              error: "'settings' must be an object.",
            },
          )
          .strict()
          .optional(),
        z.boolean({
          error: "'settings' must be a boolean or an object.",
        }),
      ])
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const validateContentItem = (item: any, path: (string | number)[]) => {
      if (!item || typeof item !== "object") return;

      if (item.type === "group") {
        if (Array.isArray(item.items)) {
          item.items.forEach((child: any, index: number) =>
            validateContentItem(child, [...path, "items", index]),
          );
        }
        return;
      }

      const actions = Array.isArray(item.actions) ? item.actions : [];
      actions.forEach((action: any, actionIndex: number) => {
        if (item.type === "collection" && action.scope == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Collection actions must define a 'scope' of 'collection' or 'entry'.",
            path: [...path, "actions", actionIndex, "scope"],
          });
        }

        if (item.type === "file" && action.scope != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "File actions cannot define a 'scope'.",
            path: [...path, "actions", actionIndex, "scope"],
          });
        }
      });
    };

    const content = data?.content;
    if (!Array.isArray(content)) return;
    content.forEach((item, index) => validateContentItem(item, ["content", index]));
  })
  .nullable();

export { ConfigSchema };
