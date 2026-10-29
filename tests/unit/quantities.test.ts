import { describe, expect, it } from "vitest";

import {
  cpus,
  mebibytes,
  milliseconds,
  parseCpus,
  parseMebibytes,
  parseMilliseconds,
  parsePort,
  parseSeconds,
  port,
  seconds,
} from "@stackpuddle/sdk";

describe("quantities", () => {
  it("bounds ports to 1 through 65535 whole numbers", () => {
    expect(parsePort(1).ok).toBe(true);
    expect(parsePort(65_535).ok).toBe(true);
    for (const bad of [0, 65_536, -1, 80.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parsePort(bad).ok, String(bad)).toBe(false);
    }
  });

  it("requires a positive whole number of mebibytes", () => {
    expect(parseMebibytes(256).ok).toBe(true);
    expect(parseMebibytes(0).ok).toBe(false);
    expect(parseMebibytes(1.5).ok).toBe(false);
  });

  it("allows two decimal places of a CPU and refuses more precision", () => {
    expect(parseCpus(0.25).ok).toBe(true);
    expect(parseCpus(1.01).ok).toBe(true);
    expect(parseCpus(0.001).ok).toBe(false);
    expect(parseCpus(0).ok).toBe(false);
    expect(parseCpus(-1).ok).toBe(false);
    expect(parseCpus(1_025).ok).toBe(false);
  });

  it("bounds seconds and milliseconds", () => {
    expect(parseSeconds(60).ok).toBe(true);
    expect(parseSeconds(0).ok).toBe(false);
    expect(parseSeconds(86_401).ok).toBe(false);
    expect(parseMilliseconds(0).ok).toBe(true);
    expect(parseMilliseconds(2_147_483_647).ok).toBe(true);
    expect(parseMilliseconds(2_147_483_648).ok).toBe(false);
    expect(parseMilliseconds(1.5).ok).toBe(false);
  });

  it("returns the value for a valid guard call and throws RangeError for an invalid one", () => {
    expect(port(8080)).toBe(8080);
    expect(mebibytes(512)).toBe(512);
    expect(cpus(0.5)).toBe(0.5);
    expect(seconds(30)).toBe(30);
    expect(milliseconds(250)).toBe(250);
    expect(() => port(0)).toThrow(RangeError);
    expect(() => cpus(0.001)).toThrow(RangeError);
  });

  it("names the quantity in the failure, with the model's code", () => {
    const parsed = parsePort(70_000);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("structure.invalid_value");
      expect(parsed.error.message).toContain("port");
    }
  });
});
