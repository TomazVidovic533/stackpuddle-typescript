import { application, defineProject, readYamlFile, secretProviders } from "@stackpuddle/sdk";
import { environment } from "@stackpuddle/sdk/compose";

import type { CaseHalf } from "../support/case.js";

/** Imports two workloads from YAML and declares the application and environment in code. */
const half: CaseHalf = async ({ root }) => {
  const imported = await readYamlFile("services/workloads.yaml", { root });
  if (!imported.ok) {
    throw new Error(
      `the YAML half did not import: ${imported.error.map((item) => item.code).join(", ")}`,
    );
  }
  const fragment = imported.value;
  const backend = application("backend", [fragment.workload("api"), fragment.workload("reindex")]);
  const local = environment("local", { context: "desktop-linux", secrets: secretProviders.local });
  return defineProject("shop", {
    declarations: [backend],
    environments: [local],
    imports: [fragment],
  });
};

export default half;

/** The application and the environment are declared in code; the workloads come from YAML. */
export const inCode = ["app/backend", "env/local"];
