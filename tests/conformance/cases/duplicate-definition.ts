import { defineProject, readYamlFile, service } from "@stackpuddle/sdk";

import type { CaseHalf } from "../support/case.js";

/** Declares workload/api in code and imports a Fragment that declares it again. */
const half: CaseHalf = async ({ root }) => {
  const imported = await readYamlFile("fragment.yaml", { root });
  if (!imported.ok) {
    throw new Error(
      `the YAML half did not import: ${imported.error.map((item) => item.code).join(", ")}`,
    );
  }
  const api = service("api", { image: "ghcr.io/example/api:1.4.2" });
  return defineProject("shop", { declarations: [api], imports: [imported.value] });
};

export default half;
