import { join } from "node:path";

export interface LangFlowArtifactPaths {
  root: string;
  generated: string;
  imported: string;
  exported: string;
  samples: string;
  catalog: string;
  runs: string;
}

export function resolveLangFlowArtifacts(projectRoot: string): LangFlowArtifactPaths {
  const root = join(projectRoot, ".otto", "langflow");
  return {
    root,
    generated: join(root, "generated"),
    imported: join(root, "imported"),
    exported: join(root, "exported"),
    samples: join(root, "samples"),
    catalog: join(root, "catalog"),
    runs: join(root, "runs"),
  };
}
