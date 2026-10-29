import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";

import { type Diagnostic, diagnostic, pointerOf } from "../model/result.js";

import definitionsSchema from "./generated/v1/definitions.schema.json" with { type: "json" };
import fragmentSchema from "./generated/v1/fragment.schema.json" with { type: "json" };
import modelSchema from "./generated/v1/model.schema.json" with { type: "json" };

/** The documents the SDK validates against stackpuddle's published schemas. */
export type DocumentKind = "fragment" | "model";

const SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/u;

const SCHEMA_IDS: Readonly<Record<DocumentKind, string>> = {
  fragment: "urn:stackpuddle:schema:v1:fragment",
  model: "urn:stackpuddle:schema:v1:model",
};

function compileAll(): Readonly<Record<DocumentKind, ValidateFunction>> {
  // No loader is configured, so a $ref to anything that is not one of the schemas below cannot be
  // fetched: compilation fails instead of reading a file or the network.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
  });
  ajv.addFormat("semver", SEMVER);
  ajv.addFormat("uri", URI);
  ajv.addSchema(definitionsSchema);
  ajv.addSchema(fragmentSchema);
  ajv.addSchema(modelSchema);
  const compile = (kind: DocumentKind): ValidateFunction => {
    const validate = ajv.getSchema(SCHEMA_IDS[kind]);
    if (validate === undefined) {
      throw new Error(`schema ${SCHEMA_IDS[kind]} is not registered`);
    }
    return validate;
  };
  return { fragment: compile("fragment"), model: compile("model") };
}

let compiled: Readonly<Record<DocumentKind, ValidateFunction>> | undefined;

function validators(): Readonly<Record<DocumentKind, ValidateFunction>> {
  compiled ??= compileAll();
  return compiled;
}

function stringParam(error: ErrorObject, name: string): string {
  const value: unknown = error.params[name];
  return typeof value === "string" ? value : "";
}

function toDiagnostic(error: ErrorObject): Diagnostic | undefined {
  const at = error.instancePath;
  const child = (segment: string): string => `${at}${pointerOf(segment)}`;
  switch (error.keyword) {
    case "additionalProperties":
      return diagnostic(
        "structure.unknown_field",
        child(stringParam(error, "additionalProperty")),
        "the field is not part of this document",
      );
    case "unevaluatedProperties":
      return diagnostic(
        "structure.unknown_field",
        child(stringParam(error, "unevaluatedProperty")),
        "the field is not part of this document",
      );
    case "required":
      return diagnostic(
        "structure.missing_field",
        child(stringParam(error, "missingProperty")),
        "a required field is missing",
      );
    case "type":
      return diagnostic(
        "structure.invalid_type",
        at,
        `the value must be of type ${stringParam(error, "type")}`,
      );
    case "oneOf":
      return diagnostic("structure.exactly_one", at, "exactly one of the alternatives must hold");
    case "propertyNames":
      return diagnostic(
        "structure.invalid_value",
        child(stringParam(error, "propertyName")),
        "the name is not valid here",
      );
    case "if":
      return undefined;
    default:
      return diagnostic(
        "structure.invalid_value",
        at,
        `the value does not satisfy ${error.keyword}`,
      );
  }
}

function isInsideAlternative(error: ErrorObject): boolean {
  return (
    /\/(?:oneOf|anyOf)\/\d/u.test(error.schemaPath) ||
    (error.propertyName !== undefined && error.keyword !== "propertyNames")
  );
}

/**
 * Validates data against a published schema. Each problem becomes one diagnostic with the Go
 * model's code and pointer; problems inside the branches of a oneOf or anyOf collapse into the
 * one diagnostic of that keyword.
 */
export function validateDocument(kind: DocumentKind, data: unknown): readonly Diagnostic[] {
  const validate = validators()[kind];
  if (validate(data)) {
    return [];
  }
  const found = new Map<string, Diagnostic>();
  for (const error of validate.errors ?? []) {
    if (isInsideAlternative(error)) {
      continue;
    }
    const item = toDiagnostic(error);
    if (item !== undefined) {
      found.set(`${item.code}\u0000${item.pointer}`, item);
    }
  }
  return [...found.values()];
}
