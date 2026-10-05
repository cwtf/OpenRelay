import test from "node:test";
import assert from "node:assert/strict";

import { paneLayout } from "./panes.ts";

const auto = { portrait: "auto", landscape: "auto" } as const;

test("phones stay single pane below 840 wide", () => {
  assert.equal(paneLayout(412, 915, auto).dual, false);
  assert.equal(paneLayout(800, 360, auto).dual, false);
  // Relay goes dual from 840 wide even on a landscape phone.
  assert.equal(paneLayout(915, 412, auto).dual, true);
});

test("auto follows Relay's isDualPane breakpoints", () => {
  // Landscape tablet: shorter side >= 480 and width >= 600.
  assert.deepEqual(paneLayout(1024, 768, auto), { dual: true, wide: true });
  assert.deepEqual(paneLayout(800, 600, auto), { dual: true, wide: false });
  // Portrait tablet needs 840 wide.
  assert.equal(paneLayout(768, 1024, auto).dual, false);
  assert.deepEqual(paneLayout(900, 1200, auto), { dual: true, wide: true });
  // Desktop windows.
  assert.deepEqual(paneLayout(1920, 1080, auto), { dual: true, wide: true });
  assert.equal(paneLayout(700, 400, auto).dual, false);
});

test("forced modes", () => {
  const dual = { portrait: "dual", landscape: "dual" } as const;
  assert.equal(paneLayout(768, 1024, dual).dual, true);
  assert.equal(paneLayout(599, 900, dual).dual, false);
  const single = { portrait: "single", landscape: "single" } as const;
  assert.equal(paneLayout(1920, 1080, single).dual, false);
  // Each orientation reads its own setting.
  const mixed = { portrait: "single", landscape: "auto" } as const;
  assert.equal(paneLayout(1000, 1400, mixed).dual, false);
  assert.equal(paneLayout(1400, 1000, mixed).dual, true);
});

test("the split widens at 900", () => {
  assert.equal(paneLayout(899, 600, auto).wide, false);
  assert.equal(paneLayout(900, 600, auto).wide, true);
});
