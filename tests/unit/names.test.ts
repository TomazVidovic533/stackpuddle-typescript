import { describe, expect, it } from "vitest";

import {
  parseCapability,
  parseEnvKey,
  parseModuleName,
  parseObjectKey,
  parseScopeName,
  supportedContract,
  supportsApiVersion,
  supportsCapability,
} from "@stackpuddle/sdk";

describe("names", () => {
  it.each(["api", "web-2", "a", "a1-b2-c3"])("accepts the object key %s", (text) => {
    expect(parseObjectKey(text).ok).toBe(true);
  });

  it.each(["", "Api", "1api", "a_b", "a.b", "a--b", "-a", "a-", "x".repeat(31)])(
    "refuses the object key %j with the model's code",
    (text) => {
      const parsed = parseObjectKey(text, "/spec/workloads/x");
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toMatchObject({
          code: "structure.invalid_value",
          pointer: "/spec/workloads/x",
        });
      }
    },
  );

  it("bounds object keys at 30 characters and scope names at 32", () => {
    expect(parseObjectKey("x".repeat(30)).ok).toBe(true);
    expect(parseScopeName("x".repeat(32)).ok).toBe(true);
    expect(parseScopeName("x".repeat(33)).ok).toBe(false);
  });

  it("refuses a dot in a project or environment name", () => {
    expect(parseScopeName("local.compose").ok).toBe(false);
  });

  it.each(["module.postgres/1", "http.api/1", "runtime.compose/12", "a.b.c/9"])(
    "accepts the capability %s",
    (text) => {
      expect(parseCapability(text).ok).toBe(true);
    },
  );

  it.each(["http", "http.api", "http.api/0", "Http.api/1", "http.api/", "http.api/01"])(
    "refuses the capability %j",
    (text) => {
      expect(parseCapability(text).ok).toBe(false);
    },
  );

  it("accepts environment variable names as the schema does and refuses others", () => {
    expect(parseEnvKey("LOG_LEVEL").ok).toBe(true);
    expect(parseEnvKey("_x1").ok).toBe(true);
    expect(parseEnvKey("1X").ok).toBe(false);
    expect(parseEnvKey("A-B").ok).toBe(false);
  });

  it("parses module names", () => {
    expect(parseModuleName("postgres").ok).toBe(true);
    expect(parseModuleName("Postgres").ok).toBe(false);
  });
});

describe("the supported contract", () => {
  it("declares its API version and capabilities, and no CLI range", () => {
    expect(supportedContract.apiVersions).toEqual(["stackpuddle/v1"]);
    expect(Object.keys(supportedContract).sort()).toEqual(["apiVersions", "capabilities"]);
    expect(supportedContract.capabilities.length).toBeGreaterThan(0);
  });

  it("checks versions and capabilities it was given", () => {
    expect(supportsApiVersion("stackpuddle/v1")).toBe(true);
    expect(supportsApiVersion("stackpuddle/v2")).toBe(false);
    const first = supportedContract.capabilities[0];
    expect(first !== undefined && supportsCapability(first)).toBe(true);
    const other = parseCapability("other.thing/1");
    expect(other.ok && supportsCapability(other.value)).toBe(false);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(supportedContract)).toBe(true);
    expect(Object.isFrozen(supportedContract.capabilities)).toBe(true);
  });
});
