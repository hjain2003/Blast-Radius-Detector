import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTerraformFiles } from "./terraformParser.js";

test("builds evidence-backed directed edges from resource references", async () => {
  const source = `resource "aws_vpc" "network" {
  cidr_block = "10.0.0.0/16"
}

data "aws_ami" "base" {
  most_recent = true
}

module "telemetry" {
  source = "./modules/telemetry"
}

resource "aws_instance" "service" {
  ami = data.aws_ami.base.id
  vpc_id = aws_vpc.network.id
  depends_on = [module.telemetry]
}`;
  const result = await analyzeTerraformFiles([{ path: "main.tf", contents: source }]);

  assert.equal(result.summary.resources, 2);
  assert.equal(result.summary.dataSources, 1);
  assert.equal(result.summary.modules, 1);
  assert.ok(result.edges.some((edge) => edge.source === "aws_vpc.network" && edge.target === "aws_instance.service" && edge.type === "attribute_reference"));
  assert.ok(result.edges.some((edge) => edge.source === "data.aws_ami.base" && edge.target === "aws_instance.service"));
  const explicit = result.edges.find((edge) => edge.type === "explicit_depends_on");
  assert.equal(explicit.source, "module.telemetry");
  assert.equal(explicit.evidence[0].file, "main.tf");
  assert.match(explicit.evidence[0].expression, /module\.telemetry/);
});

test("attaches planned replacement actions from Terraform plan JSON", async () => {
  const plan = JSON.stringify({
    format_version: "1.2",
    resource_changes: [{
      address: "aws_db_instance.store",
      mode: "managed",
      type: "aws_db_instance",
      name: "store",
      change: { actions: ["delete", "create"] },
    }],
  });
  const result = await analyzeTerraformFiles([
    { path: "main.tf", contents: 'resource "aws_db_instance" "store" { instance_class = "db.t3.micro" }' },
    { path: "plan.json", contents: plan },
  ]);

  assert.equal(result.nodes[0].change.action, "replace");
  assert.equal(result.summary.plannedChanges, 1);
});

test("reports the source filename for invalid Terraform", async () => {
  await assert.rejects(
    analyzeTerraformFiles([{ path: "broken/main.tf", contents: "resource {" }]),
    (error) => error.file === "broken/main.tf",
  );
});