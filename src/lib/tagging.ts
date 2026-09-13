/**
 * Resource tagging.
 *
 * Every resource this stack creates carries the same mandatory set, because an untagged resource is
 * one nobody can attribute a bill to. Per-resource extras and the operator's configured extras
 * merge on top, but they cannot displace the mandatory keys — losing `ManagedBy` to a typo in
 * `extraTags` would quietly defeat the cost attribution the tags exist for.
 */

import { type StackConfig } from '../config/schema.ts';

/** Arguments for {@link buildTags}. */
export interface TagOptions {
  /** Validated stack configuration, supplying environment, repository and operator extras. */
  readonly config: StackConfig;
  /** Which component the resource belongs to, e.g. `runner` or `artifacts`. */
  readonly component: string;
  /** Extra tags for this resource only. */
  readonly extra?: Readonly<Record<string, string>>;
}

/** The project every resource in this stack belongs to. */
const PROJECT_TAG = 'night-shift';

/**
 * Builds the tag map for one resource.
 *
 * Ordering is deliberate: operator extras land first, then per-resource extras, then the mandatory
 * keys last so they always win.
 */
export function buildTags(options: TagOptions): Record<string, string> {
  const { config, component, extra } = options;

  return {
    ...config.extraTags,
    ...extra,
    Project: PROJECT_TAG,
    Environment: config.environment,
    Component: component,
    Repository: config.repository,
    ManagedBy: 'pulumi',
  };
}
