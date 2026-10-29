import { bind, defineProject, exportOf, port, service } from "@stackpuddle/sdk";

import type { CaseHalf } from "../support/case.js";

/** Binds web to an export of api that api does not declare, through a reference the compiler cannot check. */
const half: CaseHalf = () => {
  const api = service("api", {
    image: "ghcr.io/example/api:1.4.2",
    listeners: { http: { port: port(8080), protocol: "http" } },
    exports: { http: { capability: "http.api/1", listener: "http" } },
  });
  const web = service("web", {
    image: "ghcr.io/example/web:3.0.0",
    dependencies: { api: "http.api/1" },
  });
  const missing = exportOf(api.ref, "grpc", "http.api/1");
  return Promise.resolve(
    defineProject("shop", { declarations: [api, web], bindings: [bind(web, "api", missing)] }),
  );
};

export default half;

/** The whole project is built in code, so no diagnostic carries a YAML file. */
export const diagnosticsInCode = true;
