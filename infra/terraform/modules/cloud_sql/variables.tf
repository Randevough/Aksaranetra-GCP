variable "project_id" {
  description = "GCP Project ID."
  type        = string
}

variable "region" {
  description = "GCP region for Cloud SQL."
  type        = string
}

variable "primary_zone" {
  description = "Primary Compute Engine zone for Cloud SQL."
  type        = string
}

variable "secondary_zone" {
  description = "Failover secondary zone for Regional HA Cloud SQL."
  type        = string
}

variable "vpc_id" {
  description = "VPC network ID for Private IP connectivity."
  type        = string
}

variable "psa_connection_id" {
  description = "Explicit dependency anchor to VPC Private Services Access peering."
  type        = string
}

variable "db_password" {
  description = "Password for the PostgreSQL application user."
  type        = string
  sensitive   = true
}

variable "db_deletion_protection" {
  description = "Controls both Terraform deletion_protection and GCP API deletion_protection_enabled."
  type        = bool
  default     = false
}
