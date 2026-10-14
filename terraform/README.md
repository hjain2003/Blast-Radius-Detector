# Terraform sample

This folder is a small AWS configuration for exercising Infrastructure Blast-Radius Detector. It includes a VPC, public and private subnets, an internet gateway, route table, EC2 service, private PostgreSQL RDS database, security groups, alarms, a data source, and a local telemetry module. The Terraform references are real so the uploaded graph is derived from these files.

## Upload it

Create a ZIP archive of this `terraform` folder, then upload the ZIP in the app. Keep the folder structure intact so the local module remains under `modules/telemetry`.

No Terraform command or AWS credentials are needed to analyze the files. Do not run `terraform apply` unless you intentionally want to create AWS resources and understand the associated costs.

The `allowed_https_cidr` default uses a reserved documentation-only IP range. This is an example configuration, not a production security policy. The sample RDS instance uses managed credentials and a private subnet group, but applying this configuration will create billable AWS resources.

## Optional plan changes

To include planned actions, add a Terraform JSON plan file named `plan.json` or `*.plan.json` to the archive. Generate one with `terraform show -json <plan-file> > plan.json` and review it before sharing; plan JSON can contain sensitive configuration values. Planned actions are displayed as metadata alongside the parsed graph.

Graph edges show Terraform reference evidence and potential impact. They do not establish guaranteed runtime dependencies or outage outcomes.
