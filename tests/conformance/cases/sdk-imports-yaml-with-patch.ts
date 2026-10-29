import { defineProject, patchWorkload, readYamlFile } from "@stackpuddle/sdk";

import type { CaseHalf } from "../support/case.js";

/** Imports a Fragment and moves the image of workload/api with a typed patch. */
const half: CaseHalf = async ({ root }) => {
  const imported = await readYamlFile("fragment.yaml", { root });
  if (!imported.ok) {
    throw new Error(
      `the YAML half did not import: ${imported.error.map((item) => item.code).join(", ")}`,
    );
  }
  const fragment = imported.value;
  const patch = patchWorkload(fragment.workload("api"), { image: "ghcr.io/example/api:1.5.0" });
  return defineProject("shop", { imports: [fragment], patches: [patch] });
};

export default half;
