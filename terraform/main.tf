terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_vpc" "network" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.network.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public"
  }
}

resource "aws_subnet" "database_a" {
  vpc_id                  = aws_vpc.network.id
  cidr_block              = "10.42.10.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.project_name}-database-a"
  }
}

resource "aws_subnet" "database_b" {
  vpc_id                  = aws_vpc.network.id
  cidr_block              = "10.42.11.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.project_name}-database-b"
  }
}

resource "aws_internet_gateway" "public_gateway" {
  vpc_id = aws_vpc.network.id

  tags = {
    Name = "${var.project_name}-public-gateway"
  }
}

resource "aws_route_table" "public_egress" {
  vpc_id = aws_vpc.network.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.public_gateway.id
  }

  tags = {
    Name = "${var.project_name}-public-egress-routes"
  }
}

resource "aws_route_table_association" "public_subnet" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public_egress.id
}

resource "aws_security_group" "service" {
  name        = "${var.project_name}-service"
  description = "Example HTTPS access rule for blast-radius exploration"
  vpc_id      = aws_vpc.network.id

  ingress {
    description = "HTTPS from the reserved documentation address range"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.allowed_https_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-service"
  }
}

resource "aws_security_group" "database" {
  name        = "${var.project_name}-database"
  description = "Allow PostgreSQL from the example service security group"
  vpc_id      = aws_vpc.network.id

  ingress {
    description     = "PostgreSQL from the service security group"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = {
    Name = "${var.project_name}-database"
  }
}

resource "aws_db_subnet_group" "database" {
  name       = "${var.project_name}-database"
  subnet_ids = [aws_subnet.database_a.id, aws_subnet.database_b.id]

  tags = {
    Name = "${var.project_name}-database"
  }
}

resource "aws_db_instance" "application" {
  identifier                  = "${var.project_name}-database"
  engine                      = "postgres"
  db_name                     = var.database_name
  instance_class              = "db.t3.micro"
  allocated_storage           = 20
  username                    = "app_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.database.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  publicly_accessible         = false
  storage_encrypted           = true
  backup_retention_period     = 0
  skip_final_snapshot         = true

  tags = {
    Name = "${var.project_name}-database"
  }
}

resource "aws_instance" "service" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.service.id]
  user_data              = "DATABASE_HOST=${aws_db_instance.application.address};DATABASE_PORT=${aws_db_instance.application.port};DATABASE_NAME=${aws_db_instance.application.db_name}"

  tags = {
    Name = "${var.project_name}-service"
  }
}

resource "aws_eip" "service" {
  domain   = "vpc"
  instance = aws_instance.service.id

  tags = {
    Name = "${var.project_name}-service-ip"
  }
}

module "telemetry" {
  source       = "./modules/telemetry"
  project_name = var.project_name
}

resource "aws_cloudwatch_metric_alarm" "service_cpu" {
  alarm_name          = "${module.telemetry.name_prefix}-cpu-high"
  alarm_description   = "Example alarm for sustained service CPU utilization."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.service.id
  }
}

resource "aws_cloudwatch_metric_alarm" "database_cpu" {
  alarm_name          = "${var.project_name}-database-cpu-high"
  alarm_description   = "Example alarm for sustained database CPU utilization."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.application.id
  }
}
