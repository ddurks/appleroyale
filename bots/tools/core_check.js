#!/usr/bin/env node
// Determinism check for core.js: its rulesDigest() (a scripted round through
// every phase, hashed step by step) must come out the same every run, and in
// every JS runtime — online prediction relies on that. In a browser with
// core.js loaded, compare with APPLE_CORE.rulesDigest().
//
//   node bots/tools/core_check.js

"use strict";
const { rulesDigest } = require("../../core.js");
const a = rulesDigest();
const b = rulesDigest();
console.log(a);
if (a !== b) {
  console.error("NOT deterministic:", b);
  process.exit(1);
}
