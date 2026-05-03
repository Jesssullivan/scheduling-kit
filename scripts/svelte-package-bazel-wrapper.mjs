#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const originalCwd = process.cwd();

function resolveExistingPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  const candidates = [
    path.join(packageRoot, value),
    value,
    path.join(originalCwd, value),
    process.env.JS_BINARY__EXECROOT
      ? path.join(process.env.JS_BINARY__EXECROOT, value)
      : undefined,
    path.resolve(value),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? value;
}

function resolvePackageCli() {
  const candidates = [
    path.join(
      packageRoot,
      "node_modules",
      "@sveltejs",
      "package",
      "src",
      "cli.js",
    ),
    path.join(
      originalCwd,
      "node_modules",
      "@sveltejs",
      "package",
      "src",
      "cli.js",
    ),
    process.env.JS_BINARY__EXECROOT
      ? path.join(
          process.env.JS_BINARY__EXECROOT,
          "node_modules",
          "@sveltejs",
          "package",
          "src",
          "cli.js",
        )
      : undefined,
  ].filter(Boolean);

  const cli = candidates.find((candidate) => existsSync(candidate));
  if (!cli) {
    throw new Error("Unable to locate @sveltejs/package CLI in Bazel runfiles");
  }
  return cli;
}

function linkOrCopy(source, destination, copy = false) {
  rmSync(destination, { recursive: true, force: true });
  if (copy) {
    cpSync(source, destination, { recursive: true });
    return;
  }
  symlinkSync(source, destination);
}

function makeWritable(target) {
  const stats = statSync(target);
  chmodSync(target, stats.isDirectory() ? 0o700 : 0o600);

  if (!stats.isDirectory()) {
    return;
  }

  for (const entry of readdirSync(target)) {
    makeWritable(path.join(target, entry));
  }
}

function prepareWritableProject(inputDir) {
  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "scheduling-kit-package-"),
  );
  const workDir = mkdirSync(path.join(tempRoot, "work"), { recursive: true });

  linkOrCopy(inputDir, path.join(workDir, "src"));
  for (const file of ["package.json", "svelte.config.js", "tsconfig.json"]) {
    linkOrCopy(resolveExistingPath(file), path.join(workDir, file));
  }

  const svelteKitDir = resolveExistingPath(".svelte-kit");
  if (existsSync(svelteKitDir)) {
    linkOrCopy(svelteKitDir, path.join(workDir, ".svelte-kit"), true);
    makeWritable(path.join(workDir, ".svelte-kit"));
  }

  const nodeModulesDir = resolveExistingPath("node_modules");
  if (existsSync(nodeModulesDir)) {
    linkOrCopy(nodeModulesDir, path.join(workDir, "node_modules"));
  }

  return { tempRoot, workDir };
}

const forwardedArgs = [];
let resolvedInput;
let outputDir = "dist";
for (let index = 0; index < process.argv.length - 2; index += 1) {
  const arg = process.argv[index + 2];

  if (arg === "-i" || arg === "--input") {
    resolvedInput = resolveExistingPath(process.argv[index + 3]);
    forwardedArgs.push(arg, "src");
    index += 1;
    continue;
  }

  if (arg.startsWith("--input=")) {
    resolvedInput = resolveExistingPath(arg.slice("--input=".length));
    forwardedArgs.push("--input=src");
    continue;
  }

  if (arg === "-o" || arg === "--output") {
    outputDir = process.argv[index + 3];
    forwardedArgs.push(arg, path.resolve(originalCwd, outputDir));
    index += 1;
    continue;
  }

  if (arg.startsWith("--output=")) {
    outputDir = arg.slice("--output=".length);
    forwardedArgs.push(`--output=${path.resolve(originalCwd, outputDir)}`);
    continue;
  }

  forwardedArgs.push(arg);
}

if (!resolvedInput) {
  throw new Error("Missing required svelte-package input directory");
}

const { tempRoot, workDir } = prepareWritableProject(resolvedInput);
const result = spawnSync(
  process.execPath,
  [resolvePackageCli(), ...forwardedArgs],
  {
    cwd: workDir,
    stdio: "inherit",
    env: process.env,
  },
);
rmSync(tempRoot, { recursive: true, force: true });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
