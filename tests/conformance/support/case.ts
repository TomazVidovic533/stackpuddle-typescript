import type { Project } from "@stackpuddle/sdk";

/** What a TypeScript half of a parity case may read: the directory of its YAML half. */
type CaseContext = {
  /** The case directory in stackpuddle's conformance cases. */
  readonly root: string;
};

/** The TypeScript half of one parity case: the project the SDK declares for the YAML half. */
export type CaseHalf = (context: CaseContext) => Promise<Project>;
