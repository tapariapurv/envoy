// @ts-nocheck -- run by Node directly (type-stripping needs the .ts extension)
// Self-checks for the retrieval helpers. Run: npm test (from the repo root).
import assert from "node:assert/strict";
import { chunk, rank, terms } from "../lib/text.ts";

const doc = ["Kenya banned single-use plastic bags in 2017.", "x ".repeat(80), "The Paris Agreement covers emissions.", "Plastic pollution harms marine life in the Indian Ocean."].join("\n\n");
const parts = chunk(doc, 200, 20);
assert.ok(parts.length >= 2, "splits into several chunks");
assert.ok(parts.every((p) => p.length <= 400), "chunks stay near the size limit");
assert.equal(chunk("a ".repeat(1000), 300, 0).every((p) => p.length <= 300), true, "hard-splits giant paragraphs");

assert.deepEqual(terms("The Plastic, and plastics!"), ["plastic", "plastics"], "drops stop words, lowercases");
const hits = rank("plastic pollution ocean", [{ text: "Paris Agreement emissions" }, { text: "plastic pollution in the ocean" }, { text: "plastic bags" }], 2);
assert.equal(hits[0].text, "plastic pollution in the ocean", "best match first");
assert.equal(hits.length, 2, "respects k and drops non-matches");
console.log("core tests passed");
