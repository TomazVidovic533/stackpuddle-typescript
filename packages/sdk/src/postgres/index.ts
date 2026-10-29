import { type JsonObject, type JsonValue } from "../model/json.js";
import { type ModuleInstanceHandle, moduleInstance } from "../model/module.js";
import type { Cpus, Mebibytes, Milliseconds, Port, Seconds } from "../model/quantities.js";
import { type Diagnostic, diagnostic, pointerOf, pointerUnder } from "../model/result.js";
import type { SecretRef } from "../model/secrets.js";

const MODULE_NAME = "postgres";
const IDENTIFIER_MAX = 63;
const identifier = /^[a-z][a-z0-9_]*$/u;

/** A PostgreSQL role that carries privileges and cannot log in. */
export type PermissionRole = { readonly kind: "postgres-role"; readonly name: string };

/** A login that applications use at run time. It belongs to at least one permission role. */
export type RuntimeUser = {
  readonly kind: "postgres-user";
  readonly purpose: "runtime";
  readonly name: string;
  readonly password: SecretRef;
  readonly memberOf: readonly [PermissionRole, ...PermissionRole[]];
};

/** A login that owns a database and runs migrations. Only a migration user can own a database. */
export type MigrationUser = {
  readonly kind: "postgres-user";
  readonly purpose: "migrations";
  readonly name: string;
  readonly password: SecretRef;
};

export type PostgresUser = RuntimeUser | MigrationUser;

export type TablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
export type SequencePrivilege = "USAGE" | "SELECT";

type NonEmpty<Item> = readonly [Item, ...Item[]];

/** Privileges one role holds in a schema. At least one of tables and sequences is required. */
export type GrantSpec = { readonly role: PermissionRole } & (
  | { readonly tables: NonEmpty<TablePrivilege>; readonly sequences?: NonEmpty<SequencePrivilege> }
  | { readonly sequences: NonEmpty<SequencePrivilege>; readonly tables?: NonEmpty<TablePrivilege> }
);

export type PostgresSchema = {
  readonly kind: "postgres-schema";
  readonly name: string;
  readonly grants: NonEmpty<GrantSpec>;
};

export type Timeouts = {
  readonly statementTimeout?: Milliseconds;
  readonly lockTimeout?: Milliseconds;
};

export type DatabaseSpec = {
  readonly owner: MigrationUser;
  readonly connectRoles: NonEmpty<PermissionRole>;
  readonly schemas: NonEmpty<PostgresSchema>;
  /** -1 is unlimited; 0 blocks ordinary connections. */
  readonly connectionLimit?: number;
  readonly settings?: Timeouts;
  readonly userSettings?: readonly { readonly user: PostgresUser; readonly timeouts: Timeouts }[];
};

export type PostgresDatabase = DatabaseSpec & {
  readonly kind: "postgres-database";
  readonly name: string;
};

export type PostgresOptions = {
  readonly users: NonEmpty<PostgresUser>;
  readonly roles: NonEmpty<PermissionRole>;
  readonly databases: NonEmpty<PostgresDatabase>;
  readonly resources?: { readonly memory?: Mebibytes; readonly cpus?: Cpus };
  readonly hostAccess?:
    { readonly enabled: false } | { readonly enabled: true; readonly port: Port };
  readonly startupTimeout?: Seconds;
  readonly settings?: { readonly maxConnections?: number; readonly sharedBuffers?: Mebibytes };
  readonly description?: string;
};

export function permissionRole(name: string): PermissionRole {
  return Object.freeze({ kind: "postgres-role", name });
}

export function runtimeUser(
  name: string,
  spec: { readonly password: SecretRef; readonly memberOf: NonEmpty<PermissionRole> },
): RuntimeUser {
  return Object.freeze({ kind: "postgres-user", purpose: "runtime", name, ...spec });
}

export function migrationUser(name: string, spec: { readonly password: SecretRef }): MigrationUser {
  return Object.freeze({ kind: "postgres-user", purpose: "migrations", name, ...spec });
}

export function schema(name: string, grants: NonEmpty<GrantSpec>): PostgresSchema {
  return Object.freeze({ kind: "postgres-schema", name, grants });
}

export function database(name: string, spec: DatabaseSpec): PostgresDatabase {
  return Object.freeze({ kind: "postgres-database", name, ...spec });
}

type Named = { readonly name: string };

type Collect = <Item extends Named>(
  items: readonly Item[],
  pointer: string,
  convert: (item: Item) => JsonValue,
) => JsonObject;

function isPostgresName(name: string): boolean {
  return name.length <= IDENTIFIER_MAX && identifier.test(name) && !name.startsWith("pg_");
}

/**
 * Returns a function that collects named items into a record. A name that appears twice is
 * reported instead of letting one win, and a name PostgreSQL would refuse is reported too.
 */
function collector(problems: Diagnostic[]): Collect {
  return (items, pointer, convert) => {
    const entries = new Map<string, JsonValue>();
    for (const item of items) {
      const at = pointerUnder(pointer, item.name);
      if (entries.has(item.name)) {
        problems.push(
          diagnostic("identity.duplicate_declaration", at, "the name is declared more than once"),
        );
      } else if (!isPostgresName(item.name)) {
        problems.push(
          diagnostic(
            "structure.invalid_value",
            at,
            "a PostgreSQL name is lowercase letters, digits and underscores, up to 63, not starting with pg_",
          ),
        );
      }
      entries.set(item.name, convert(item));
    }
    return Object.fromEntries(entries);
  };
}

function timeoutsJson(timeouts: Timeouts): JsonObject {
  return {
    ...(timeouts.statementTimeout === undefined
      ? {}
      : { statementTimeoutMs: timeouts.statementTimeout }),
    ...(timeouts.lockTimeout === undefined ? {} : { lockTimeoutMs: timeouts.lockTimeout }),
  };
}

function userJson(user: PostgresUser): JsonObject {
  return {
    purpose: user.purpose,
    passwordSecretRef: user.password.id,
    ...(user.purpose === "runtime" ? { memberOf: user.memberOf.map((role) => role.name) } : {}),
  };
}

function grantJson(grants: NonEmpty<GrantSpec>, pointer: string, collect: Collect): JsonObject {
  return collect(
    grants.map((grant) => ({ name: grant.role.name, grant })),
    pointer,
    ({ grant }) => ({
      ...(grant.tables === undefined ? {} : { tables: [...grant.tables] }),
      ...(grant.sequences === undefined ? {} : { sequences: [...grant.sequences] }),
    }),
  );
}

function schemasJson(
  schemas: NonEmpty<PostgresSchema>,
  pointer: string,
  collect: Collect,
): JsonObject {
  return collect(schemas, pointer, (entry) => ({
    grants: grantJson(entry.grants, pointerUnder(pointer, entry.name, "grants"), collect),
  }));
}

function userSettingsJson(
  settings: NonNullable<DatabaseSpec["userSettings"]>,
  pointer: string,
  collect: Collect,
): JsonObject {
  return collect(
    settings.map((entry) => ({ name: entry.user.name, timeouts: entry.timeouts })),
    pointer,
    (entry) => timeoutsJson(entry.timeouts),
  );
}

function databaseJson(item: PostgresDatabase, pointer: string, collect: Collect): JsonObject {
  return {
    owner: item.owner.name,
    connectRoles: item.connectRoles.map((role) => role.name),
    schemas: schemasJson(item.schemas, pointerUnder(pointer, "schemas"), collect),
    ...(item.connectionLimit === undefined ? {} : { connectionLimit: item.connectionLimit }),
    ...(item.settings === undefined ? {} : { settings: timeoutsJson(item.settings) }),
    ...(item.userSettings === undefined
      ? {}
      : {
          userSettings: userSettingsJson(
            item.userSettings,
            pointerUnder(pointer, "userSettings"),
            collect,
          ),
        }),
  };
}

function resourcesJson(resources: NonNullable<PostgresOptions["resources"]>): JsonObject {
  return {
    ...(resources.memory === undefined ? {} : { memoryMiB: resources.memory }),
    ...(resources.cpus === undefined ? {} : { cpus: resources.cpus }),
  };
}

function settingsJson(settings: NonNullable<PostgresOptions["settings"]>): JsonObject {
  return {
    ...(settings.maxConnections === undefined ? {} : { maxConnections: settings.maxConnections }),
    ...(settings.sharedBuffers === undefined ? {} : { sharedBuffersMiB: settings.sharedBuffers }),
  };
}

function hostAccessJson(access: NonNullable<PostgresOptions["hostAccess"]>): JsonObject {
  return access.enabled ? { enabled: true, port: access.port } : { enabled: false };
}

function optionsJson(options: PostgresOptions, base: string, collect: Collect): JsonObject {
  return {
    users: collect(options.users, pointerUnder(base, "users"), userJson),
    roles: collect(options.roles, pointerUnder(base, "roles"), () => ({ login: false })),
    databases: collect(options.databases, pointerUnder(base, "databases"), (item) =>
      databaseJson(item, pointerUnder(base, "databases", item.name), collect),
    ),
    ...(options.resources === undefined ? {} : { resources: resourcesJson(options.resources) }),
    ...(options.hostAccess === undefined ? {} : { hostAccess: hostAccessJson(options.hostAccess) }),
    ...(options.startupTimeout === undefined
      ? {}
      : { startupTimeoutSeconds: options.startupTimeout }),
    ...(options.settings === undefined ? {} : { settings: settingsJson(options.settings) }),
  };
}

/**
 * Declares a PostgreSQL instance. The SDK checks only what types give for free, such as a database
 * owner being a migration user. Whether roles and owners refer to each other correctly is the
 * semantic validator's job; it runs from the CLI, not here.
 */
export function instance(key: string, options: PostgresOptions): ModuleInstanceHandle {
  const problems: Diagnostic[] = [];
  const base = pointerOf("spec", "modules", key, "options");
  const handle = moduleInstance(key, {
    definition: MODULE_NAME,
    options: optionsJson(options, base, collector(problems)),
    ...(options.description === undefined ? {} : { description: options.description }),
  });
  return Object.freeze({
    ...handle,
    declaration: Object.freeze({
      ...handle.declaration,
      problems: [...handle.declaration.problems, ...problems],
    }),
  });
}
