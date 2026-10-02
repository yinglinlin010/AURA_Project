import test from "node:test";
import assert from "node:assert/strict";
import { brandFromEnvironment, resolveBrand } from "../../../packages/core-domain/src/brand.js";

test("brand configuration defaults to the working codename", () => {
  assert.deepEqual(brandFromEnvironment({}), {
    productName: "AURA",
    assistantName: "AURA",
    wakeWord: "Hey AURA",
  });
});

test("brand values can be renamed independently and whitespace falls back", () => {
  assert.deepEqual(brandFromEnvironment({
    AURA_PRODUCT_NAME: "  ORBIT  ",
    AURA_ASSISTANT_NAME: "NOVA",
    AURA_WAKE_WORD: "  ",
  }), {
    productName: "ORBIT",
    assistantName: "NOVA",
    wakeWord: "Hey AURA",
  });
  assert.deepEqual(resolveBrand({ productName: "", assistantName: " KAI " }), {
    productName: "AURA",
    assistantName: "KAI",
    wakeWord: "Hey AURA",
  });
});
