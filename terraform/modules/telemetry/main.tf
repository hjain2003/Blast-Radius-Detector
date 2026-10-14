variable "project_name" {
  description = "Prefix used for telemetry resource names."
  type        = string
}

resource "aws_cloudwatch_log_group" "infrastructure" {
  name              = "/${var.project_name}/infrastructure"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-infrastructure-logs"
  }
}

output "name_prefix" {
  description = "Name prefix used by resources that integrate with this module."
  value       = var.project_name
}
