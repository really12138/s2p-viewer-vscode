import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { webviewBuildConfig } from "./webviewBuildConfig.mjs";

const noticePath = resolve(process.cwd(), "THIRD_PARTY_NOTICES.md");
const checkOnly = process.argv.includes("--check");

const standardMitTerms = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const licenseOverrides = new Map([
  [
    "has-hover@1.0.1",
    {
      source: "package.json license and author metadata",
      text: `MIT License\n\nCopyright (c) Dima Yv\n\n${standardMitTerms}`,
    },
  ],
  [
    "native-promise-only@0.8.1",
    {
      source: "lib/npo.src.js license header",
      text: `MIT License\n\nCopyright (c) Kyle Simpson\n\n${standardMitTerms}`,
    },
  ],
]);

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n").trim();
}

function comparePackages(left, right) {
  const leftKey = `${left.name}@${left.version}`;
  const rightKey = `${right.name}@${right.version}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function packageRootFromInput(input) {
  const normalized = input.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) {
    return undefined;
  }

  const packageStart = nodeModulesIndex + 1;
  const first = segments[packageStart];
  if (first === undefined) {
    throw new Error(`Cannot resolve package for bundle input: ${input}`);
  }

  const packageLength = first.startsWith("@") ? 2 : 1;
  return resolve(
    process.cwd(),
    segments.slice(0, packageStart + packageLength).join("/"),
  );
}

function repositoryUrl(repository) {
  const raw =
    typeof repository === "string"
      ? repository
      : repository && typeof repository.url === "string"
        ? repository.url
        : undefined;
  return raw?.replace(/^git\+/, "").replace(/^git:\/\//, "https://");
}

function readLicense(packageRoot, packageName, version) {
  const legalFiles = readdirSync(packageRoot)
    .filter((name) => /^(licen[cs]e|copying|notice)(\..+)?$/i.test(name))
    .sort();

  if (legalFiles.length > 0) {
    return {
      source: legalFiles.join(", "),
      text: legalFiles
        .map((name) => normalizeNewlines(readFileSync(resolve(packageRoot, name), "utf8")))
        .join("\n\n---\n\n"),
    };
  }

  const key = `${packageName}@${version}`;
  const override = licenseOverrides.get(key);
  if (override !== undefined) {
    return override;
  }

  const readmeName = readdirSync(packageRoot).find((name) => /^readme\.md$/i.test(name));
  if (readmeName !== undefined) {
    const readme = normalizeNewlines(
      readFileSync(resolve(packageRoot, readmeName), "utf8"),
    );
    const match = /(?:^|\n)## License\s*\n([\s\S]*?)(?=\n## |$)/i.exec(readme);
    if (match?.[1] !== undefined) {
      return {
        source: `${readmeName} license section`,
        text: normalizeNewlines(match[1])
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">"),
      };
    }
  }

  throw new Error(
    `No distributable license text found for ${key}; add and review an explicit override.`,
  );
}

async function bundledPackages() {
  const result = await build({
    ...webviewBuildConfig,
    metafile: true,
    sourcemap: false,
    write: false,
    logLevel: "silent",
  });
  const roots = new Set();

  for (const input of Object.keys(result.metafile.inputs)) {
    const packageRoot = packageRootFromInput(input);
    if (packageRoot !== undefined) {
      roots.add(packageRoot);
    }
  }

  return [...roots]
    .map((packageRoot) => {
      const manifest = JSON.parse(
        readFileSync(resolve(packageRoot, "package.json"), "utf8"),
      );
      if (
        typeof manifest.name !== "string" ||
        typeof manifest.version !== "string" ||
        typeof manifest.license !== "string"
      ) {
        throw new Error(`Incomplete package metadata in ${packageRoot}`);
      }

      return {
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
        repository: repositoryUrl(manifest.repository),
        ...readLicense(packageRoot, manifest.name, manifest.version),
      };
    })
    .sort(comparePackages);
}

function renderNotice(packages) {
  const sections = packages.map((item) => {
    const metadata = [
      `License: ${item.license}`,
      ...(item.repository === undefined ? [] : [`Repository: ${item.repository}`]),
      `License text source: ${item.source}`,
    ].join("\n\n");

    return `## ${item.name} ${item.version}\n\n${metadata}\n\n\`\`\`text\n${item.text}\n\`\`\``;
  });

  return `# Third-Party Notices

This file is generated from the packages actually included by the production
Webview bundle. Run \`npm run notices:generate\` after changing bundled
dependencies, and commit the result.

${sections.join("\n\n")}
`;
}

const packages = await bundledPackages();
const expected = renderNotice(packages);

if (checkOnly) {
  const actual = normalizeNewlines(readFileSync(noticePath, "utf8"));
  if (actual !== expected.trim()) {
    console.error(
      "THIRD_PARTY_NOTICES.md is out of date. Run npm run notices:generate and review the result.",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(noticePath, expected, "utf8");
  console.log(`Updated THIRD_PARTY_NOTICES.md for ${packages.length} packages.`);
}
