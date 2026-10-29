import { type Capability, parseCapability } from "../model/names.js";

/** The model API versions this SDK reads and writes. */
export const SUPPORTED_API_VERSIONS = ["stackpuddle/v1"] as const;

function capabilitiesOf(names: readonly string[]): readonly Capability[] {
  return names.map((name) => {
    const parsed = parseCapability(name);
    if (!parsed.ok) {
      throw new Error(`supported capability ${name} is not a capability`);
    }
    return parsed.value;
  });
}

/**
 * What this SDK supports: model API versions and authoring capabilities. It states no CLI version
 * range; the CLI reads the model file and checks the API version itself.
 */
export const supportedContract: {
  readonly apiVersions: readonly ["stackpuddle/v1"];
  readonly capabilities: readonly Capability[];
} = Object.freeze({
  apiVersions: SUPPORTED_API_VERSIONS,
  capabilities: Object.freeze(
    capabilitiesOf([
      "authoring.canonical-model/1",
      "authoring.yaml-import/1",
      "authoring.typed-patch/1",
      "runtime.compose/1",
      "secrets.local/1",
    ]),
  ),
});

export function supportsApiVersion(apiVersion: string): boolean {
  return SUPPORTED_API_VERSIONS.some((supported) => supported === apiVersion);
}

export function supportsCapability(capability: Capability): boolean {
  return supportedContract.capabilities.includes(capability);
}
