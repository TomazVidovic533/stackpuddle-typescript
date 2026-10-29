import { type Diagnostic, type Result, diagnostic, fail, succeed } from "./result.js";

declare const unit: unique symbol;
type Quantity<Unit extends string> = number & { readonly [unit]: Unit };

/** A TCP or UDP port, 1 to 65535. */
export type Port = Quantity<"port">;
/** A memory size in mebibytes. */
export type Mebibytes = Quantity<"MiB">;
/** A CPU allocation; fractions of a CPU are allowed to two decimal places. */
export type Cpus = Quantity<"cpus">;
/** A duration in whole seconds. */
export type Seconds = Quantity<"s">;
/** A duration in whole milliseconds. */
export type Milliseconds = Quantity<"ms">;

type Rule = {
  readonly what: string;
  readonly min: number;
  readonly max: number;
  readonly wholeNumber: boolean;
  readonly description: string;
};

const RULES = {
  port: {
    what: "port",
    min: 1,
    max: 65_535,
    wholeNumber: true,
    description: "a whole number from 1 to 65535",
  },
  mebibytes: {
    what: "memory",
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    wholeNumber: true,
    description: "a positive whole number of mebibytes",
  },
  cpus: {
    what: "cpus",
    min: 0.01,
    max: 1_024,
    wholeNumber: false,
    description: "from 0.01 to 1024, with at most two decimal places",
  },
  seconds: {
    what: "seconds",
    min: 1,
    max: 86_400,
    wholeNumber: true,
    description: "a whole number from 1 to 86400",
  },
  milliseconds: {
    what: "milliseconds",
    min: 0,
    max: 2_147_483_647,
    wholeNumber: true,
    description: "a whole number from 0 to 2147483647",
  },
} as const satisfies Record<string, Rule>;

const CPU_STEPS_PER_UNIT = 100;
const CPU_STEP_TOLERANCE = 1e-9;

function isValid(rule: Rule, value: number): boolean {
  if (!Number.isFinite(value) || value < rule.min || value > rule.max) {
    return false;
  }
  if (rule.wholeNumber) {
    return Number.isInteger(value);
  }
  const steps = value * CPU_STEPS_PER_UNIT;
  return Math.abs(steps - Math.round(steps)) < CPU_STEP_TOLERANCE;
}

function parseQuantity<Branded extends number>(
  rule: Rule,
  value: number,
): Result<Branded, Diagnostic> {
  return isValid(rule, value)
    ? succeed(value as Branded)
    : fail(
        diagnostic(
          "structure.invalid_value",
          "",
          `${rule.what} ${String(value)} is not valid: ${rule.description}`,
        ),
      );
}

function expect<Branded extends number>(result: Result<Branded, Diagnostic>): Branded {
  if (!result.ok) {
    throw new RangeError(result.error.message);
  }
  return result.value;
}

export function parsePort(value: number): Result<Port, Diagnostic> {
  return parseQuantity<Port>(RULES.port, value);
}

export function parseMebibytes(value: number): Result<Mebibytes, Diagnostic> {
  return parseQuantity<Mebibytes>(RULES.mebibytes, value);
}

export function parseCpus(value: number): Result<Cpus, Diagnostic> {
  return parseQuantity<Cpus>(RULES.cpus, value);
}

export function parseSeconds(value: number): Result<Seconds, Diagnostic> {
  return parseQuantity<Seconds>(RULES.seconds, value);
}

export function parseMilliseconds(value: number): Result<Milliseconds, Diagnostic> {
  return parseQuantity<Milliseconds>(RULES.milliseconds, value);
}

/** Builds a port; throws RangeError for a value outside 1 to 65535, which is a programming fault. */
export function port(value: number): Port {
  return expect(parsePort(value));
}

export function mebibytes(value: number): Mebibytes {
  return expect(parseMebibytes(value));
}

export function cpus(value: number): Cpus {
  return expect(parseCpus(value));
}

export function seconds(value: number): Seconds {
  return expect(parseSeconds(value));
}

export function milliseconds(value: number): Milliseconds {
  return expect(parseMilliseconds(value));
}
