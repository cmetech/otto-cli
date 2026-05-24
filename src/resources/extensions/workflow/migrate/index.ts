// Barrel export for old .planning migration module

export { handleMigrate } from './command.js';
export { parsePlanningDirectory } from './parser.js';
export { validatePlanningDirectory } from './validator.js';
export { transformToGSD } from './transformer.js';
export { writeAgentDirectory } from './writer.js';
export { resolveMigrationPaths, assertMigrationHasSlices } from './safety.js';
export { archiveLegacyPlanningDirectory, verifyMigrationProjection } from './audit.js';
export type { WrittenFiles, MigrationPreview } from './writer.js';
export { generatePreview } from './preview.js';
export type {
  // Input types (old .planning format)
  PlanningProject,
  PlanningPhase,
  PlanningPlan,
  PlanningPlanFrontmatter,
  PlanningPlanMustHaves,
  PlanningSummary,
  PlanningSummaryFrontmatter,
  PlanningSummaryRequires,
  PlanningRoadmap,
  PlanningRoadmapMilestone,
  PlanningRoadmapEntry,
  PlanningRequirement,
  PlanningResearch,
  PlanningConfig,
  PlanningQuickTask,
  PlanningMilestone,
  PlanningState,
  PlanningPhaseFile,
  ValidationResult,
  ValidationIssue,
  ValidationSeverity,
  // Output types (current format)
  WorkflowProject,
  WorkflowMilestone,
  WorkflowSlice,
  WorkflowTask,
  WorkflowRequirement,
  SliceSummaryData,
  TaskSummaryData,
  BoundaryEntry,
} from './types.js';
