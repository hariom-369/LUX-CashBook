import axe from 'axe-core';

/**
 * Structural accessibility check for a rendered component tree (§Phase 16).
 *
 * Runs axe-core in jsdom. Rules that need a real layout engine (colour contrast,
 * target size, visibility-dependent checks) cannot run here and are covered by the
 * browser audit instead, so they are switched off rather than reported as passes.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      'target-size': { enabled: false },
      region: { enabled: false }, // component fragments are not whole pages
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}
