// packages/coworker-artifacts/src/errors.ts
export class ArtifactNotFound extends Error {
  constructor(public readonly slug: string) {
    super(`Artifact not found: ${slug}. /artifacts list to see available.`);
    this.name = 'ArtifactNotFound';
  }
}

export class ArtifactKindRejected extends Error {
  constructor(public readonly kind: string) {
    super(`Artifact kind '${kind}' is not supported. v1 ships only 'report'.`);
    this.name = 'ArtifactKindRejected';
  }
}

export class ArtifactUriMalformed extends Error {
  constructor(public readonly uri: string, public readonly reason: string) {
    super(`Bad artifact URI ${uri}: ${reason}.`);
    this.name = 'ArtifactUriMalformed';
  }
}

export class ArtifactSlugCollision extends Error {
  constructor(public readonly base: string, public readonly attempts: number) {
    super(`Slug collision: '${base}' has ${attempts} colliding suffixes (-2…-${attempts + 1}). Pick a different name.`);
    this.name = 'ArtifactSlugCollision';
  }
}
