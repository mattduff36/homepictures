import test from "node:test";
import assert from "node:assert/strict";
import { VIEWER_CAMERAS } from "./viewer-protocol";
import { normalizePreferences, effectiveLayout, featuredSlots } from "./vision-layout";

test("layout preferences are bounded, private to the device and deterministic", () => {
  assert.deepEqual(normalizePreferences({layout:"bad",seconds:-10,fit:"bad",dataSaver:"yes"}), {layout:"auto",seconds:5,fit:"cover",dataSaver:false});
  assert.equal(normalizePreferences({seconds:Infinity}).seconds,15);
  assert.deepEqual(Object.keys(normalizePreferences({password:"secret",token:"secret",snapshot:"image",layout:"grid"})).sort(), ["dataSaver","fit","layout","seconds"]);
  assert.equal(normalizePreferences({seconds:9000}).seconds,3600);
  assert.equal(effectiveLayout("auto",true,null),"featured");
  assert.equal(effectiveLayout("auto",false,null),"grid");
  assert.equal(effectiveLayout("auto",false,"featured"),"featured");
  assert.equal(effectiveLayout("grid",true,"featured"),"grid");
});

test("featured retains each authorized camera exactly once and four Swann rails", () => {
  for (const [index, camera] of VIEWER_CAMERAS.entries()) {
    const slots=featuredSlots(VIEWER_CAMERAS,camera.id,index);
    assert.deepEqual(Object.keys(slots).sort(),VIEWER_CAMERAS.map(camera=>camera.id).sort());
    assert.equal(slots[camera.id],"vision-feature-main");
    assert.equal(Object.values(slots).filter(slot=>slot.startsWith("vision-feature-left")).length,4);
    assert.equal(Object.values(slots).filter(slot=>slot==="vision-feature-main").length,1);
    assert.equal(Object.values(slots).filter(slot=>slot==="vision-feature-held").length,camera.kind==="ring"?1:0);
  }
  const subset=VIEWER_CAMERAS.slice(0,2);
  assert.deepEqual(Object.keys(featuredSlots(subset,"missing",0)).sort(),subset.map(camera=>camera.id).sort());
  assert.deepEqual(featuredSlots([],"missing",0),{});
});
