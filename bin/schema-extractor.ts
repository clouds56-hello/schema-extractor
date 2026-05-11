#!/usr/bin/env bun
import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
