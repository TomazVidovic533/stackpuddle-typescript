import { describe, expect, it } from "vitest";

import { canonicalize } from "../../packages/sdk/src/serialization/canonical.js";

describe("canonicalize", () => {
  it("sorts keys by UTF-16 code units, not by code point", () => {
    // U+1F600 is the units D83D DE00; U+FFFD is the unit FFFD. By code point U+FFFD comes first.
    const text = canonicalize({ "�": 1, "\u{1F600}": 2, b: 3, a: 4 });
    expect(text).toBe(`{\n  "a": 4,\n  "b": 3,\n  "\u{1F600}": 2,\n  "�": 1\n}\n`);
  });

  it("keeps integer-like keys in string order instead of the engine's numeric order", () => {
    expect(canonicalize({ "9": 1, "10": 2, "1": 3 })).toBe(
      `{\n  "1": 3,\n  "10": 2,\n  "9": 1\n}\n`,
    );
  });

  it("escapes the quote, the backslash and every control character as JSON.stringify does", () => {
    const controls = Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)).join("");
    const printed = canonicalize(`"\\${controls}`);
    expect(printed).toBe(
      `"\\"\\\\\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f` +
        `\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f"\n`,
    );
  });

  it("leaves line and paragraph separators, angle brackets and ampersands as they are", () => {
    expect(canonicalize("\u2028\u2029<>&")).toBe(`"\u2028\u2029<>&"\n`);
  });

  it("prints integers up to 2^53-1 as integers and other numbers as ECMAScript does", () => {
    expect(canonicalize([9_007_199_254_740_991, -9_007_199_254_740_991, 0, -0])).toBe(
      "[\n  9007199254740991,\n  -9007199254740991,\n  0,\n  0\n]\n",
    );
    expect(canonicalize([1.5, 1e21, 1e-7, 0.000001, 1.25e-10, 100])).toBe(
      "[\n  1.5,\n  1e+21,\n  1e-7,\n  0.000001,\n  1.25e-10,\n  100\n]\n",
    );
  });

  it("prints empty objects and arrays inside options as {} and []", () => {
    expect(canonicalize({ options: { labels: {}, list: [] } })).toBe(
      `{\n  "options": {\n    "labels": {},\n    "list": []\n  }\n}\n`,
    );
  });

  it("uses two-space indentation, one array element per line and a trailing newline", () => {
    expect(canonicalize({ a: [1, { b: true }] })).toBe(
      `{\n  "a": [\n    1,\n    {\n      "b": true\n    }\n  ]\n}\n`,
    );
  });

  it("refuses numbers JSON cannot hold", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
