import fs from "node:fs";

const migrationDir = "worker/migrations";
const deployWorkflow = fs.readFileSync(".github/workflows/deploy-momentum-stack.yml", "utf8");

const files = fs.readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
if (!files.length) throw new Error("No numbered D1 migrations found.");

const missing = files.filter(name => !deployWorkflow.includes(name));
if (missing.length) {
  throw new Error(`Deploy workflow does not sync these public D1 migrations into the private engine checkout: ${missing.join(", ")}`);
}

console.log(`Migration sync contract passed for ${files.length} migrations.`);
