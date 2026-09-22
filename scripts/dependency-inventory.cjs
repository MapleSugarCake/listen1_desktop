const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs/maintenance");
const baseline = path.join(root, "dist/maintenance/baseline");
const layers = [".", "app", "app/listen1_chrome_extension"];
const read = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function packages(lock) {
  if (lock.packages)
    return Object.entries(lock.packages)
      .filter(([key]) => key)
      .map(([location, entry]) => ({
        name: location.split("node_modules/").at(-1),
        location,
        ...entry,
      }));
  const result = [];
  function walk(dependencies, parent = "") {
    for (const [name, entry] of Object.entries(dependencies || {})) {
      const location = parent + "node_modules/" + name;
      result.push({ name, location, ...entry });
      walk(entry.dependencies, location + "/");
    }
  }
  walk(lock.dependencies);
  return result;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const inventory = {
    generated: new Date().toISOString(),
    runtime: process.version,
    layers: [],
    latestDirect: [],
  };
  const directNames = new Set();
  for (const layer of layers) {
    const manifest = read(path.join(root, layer, "package.json"));
    const old = packages(read(path.join(baseline, layer, "package-lock.json")));
    const current = packages(read(path.join(root, layer, "package-lock.json")));
    const direct = { ...manifest.dependencies, ...manifest.devDependencies };
    Object.keys(direct).forEach((name) => directNames.add(name));
    const records = current.map((entry) => {
      const before = [
        ...new Set(
          old
            .filter((prior) => prior.name === entry.name)
            .map((prior) => prior.version)
        ),
      ];
      return {
        name: entry.name,
        version: entry.version,
        location: entry.location,
        direct:
          entry.location === `node_modules/${entry.name}` &&
          !!direct[entry.name],
        before,
        decision: before.includes(entry.version)
          ? "retain"
          : "upgrade-or-replace",
        reason: direct[entry.name]
          ? "Pinned direct candidate; see validation report"
          : "Resolved by the upgraded parent package and pinned in this lockfile; no forced transitive override",
        license: entry.license,
        integrity: entry.integrity,
        resolved: entry.resolved,
      };
    });
    for (const prior of old)
      if (
        !current.some((entry) => entry.name === prior.name) &&
        !records.some(
          (entry) => entry.name === prior.name && entry.decision === "remove"
        )
      )
        records.push({
          name: prior.name,
          before: [
            ...new Set(
              old
                .filter((entry) => entry.name === prior.name)
                .map((entry) => entry.version)
            ),
          ],
          decision: "remove",
          reason:
            "Removed with its old direct dependency or replaced parent graph",
        });
    inventory.layers.push({ layer, direct, packages: records });
  }
  const queue = [...directNames];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const name = queue.pop();
        try {
          const source = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
          let data;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await fetch(source, {
              signal: AbortSignal.timeout(12000),
            });
            if (!response.ok) throw new Error(String(response.status));
            data = await response.json();
            if (typeof data.version === "string") break;
          }
          if (typeof data.version !== "string")
            throw new Error("Registry response has no version");
          inventory.latestDirect.push({
            name,
            latest: data.version,
            engines: data.engines,
            deprecated: data.deprecated || null,
            source,
          });
        } catch (error) {
          inventory.latestDirect.push({ name, unverified: error.message });
        }
      }
    })
  );
  inventory.latestDirect.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(
    path.join(output, "dependencies.json"),
    JSON.stringify(inventory, null, 2) + "\n"
  );
  const npm = path.resolve(
    process.env.LISTEN1_NPM_CLI ||
      path.join(root, "dist/maintenance/npm12/node_modules/npm/bin/npm-cli.js")
  );
  for (const [index, layer] of layers.entries()) {
    const result = cp.spawnSync(
      process.execPath,
      [
        npm,
        "audit",
        "--json",
        "--registry=https://registry.npmjs.org",
        "--prefix",
        path.join(root, layer),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 60000 }
    );
    try {
      const audit = JSON.parse(result.stdout);
      fs.writeFileSync(
        path.join(output, `audit-${index}.json`),
        JSON.stringify(audit, null, 2) + "\n"
      );
      console.log(
        layer,
        JSON.stringify(audit.metadata?.vulnerabilities || audit.error)
      );
    } catch {
      console.log(layer, "Audit unavailable");
    }
  }
  console.log(
    "Direct version comparison:",
    JSON.stringify(
      inventory.latestDirect.map((item) => ({
        name: item.name,
        latest: item.latest,
        locked: inventory.layers
          .map((layer) => layer.direct[item.name])
          .filter(Boolean),
      }))
    )
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
