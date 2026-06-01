import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonaManifest, type PersonaManifest } from './manifest.js';

describe('persona manifest', () => {
  it('parses a minimum-valid manifest', () => {
    const yaml = `
name: noc-ops
display_name: "NOC / IT Ops Analyst"
version: 1.0.0
description: "NOC analyst co-worker"
author: "@cmetech"
otto_version_required: ">=2.0.0"
steering:
  - steering/identity.md
status_line:
  label: NOC
  color: "#FAD22D"
  icon: "🛡"
`;
    const m: PersonaManifest = parsePersonaManifest(yaml);
    assert.equal(m.name, 'noc-ops');
    assert.equal(m.steering.length, 1);
    assert.equal(m.status_line.label, 'NOC');
  });

  it('rejects manifest missing required name', () => {
    const yaml = 'version: 1.0.0';
    assert.throws(() => parsePersonaManifest(yaml), /name/);
  });

  it('rejects manifest missing version', () => {
    const yaml = 'name: noc-ops';
    assert.throws(() => parsePersonaManifest(yaml), /version/);
  });

  it('defaults memory_seed.apply_on_first_activation to false when absent', () => {
    const yaml = `
name: x
display_name: x
version: 1.0.0
description: x
author: x
otto_version_required: ">=2.0.0"
steering: []
status_line: { label: X, color: "#000000", icon: "x" }
`;
    const m = parsePersonaManifest(yaml);
    assert.equal(m.memory_seed?.apply_on_first_activation ?? false, false);
  });

  it('parses artifact_kinds list when provided', () => {
    const yaml = `
name: x
display_name: x
version: 1.0.0
description: x
author: x
otto_version_required: ">=2.0.0"
steering: []
status_line: { label: X, color: "#000", icon: "x" }
artifact_kinds: [report, workbook, inventory_report]
`;
    const m = parsePersonaManifest(yaml);
    assert.deepEqual(m.artifact_kinds, ['report', 'workbook', 'inventory_report']);
  });
});
