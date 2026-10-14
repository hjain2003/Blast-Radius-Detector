variable "aws_region" {
  description = "AWS region used by this example."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix used for example resource names."
  type        = string
  default     = "blast-radius-demo"
}

variable "allowed_https_cidr" {
  description = "Documentation-only source range for the example HTTPS rule."
  type        = string
  default     = "203.0.113.0/24"
}

variable "database_name" {
  description = "Name of the example PostgreSQL database."
  type        = string
  default     = "application"
}