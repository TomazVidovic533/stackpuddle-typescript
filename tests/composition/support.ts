import { type ImportedFragment, importYaml } from "@stackpuddle/sdk";

/** Imports YAML that the test expects to be valid. */
export function fragmentOf(file: string, text: string): ImportedFragment {
  const result = importYaml(file, text);
  if (!result.ok) {
    throw new Error(`fixture did not import: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

export const WORKLOADS_YAML = `apiVersion: stackpuddle/v1
kind: Fragment
spec:
  workloads:
    api:
      type: service
      image: ghcr.io/example/api:1.4.2
      environment:
        LOG_LEVEL: info
      listeners:
        http:
          port: 8080
          protocol: http
      exports:
        http:
          capability: http.api/1
          listener: http
    web:
      type: service
      image: ghcr.io/example/web:3.0.0
      dependencies:
        api:
          capability: http.api/1
`;

export const ENVIRONMENT_YAML = `apiVersion: stackpuddle/v1
kind: Fragment
spec:
  environments:
    local:
      runtime:
        type: compose
        context: desktop-linux
      secrets:
        provider: local
`;
