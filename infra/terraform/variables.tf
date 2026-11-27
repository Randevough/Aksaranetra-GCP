variable "project_id" {
  description = "GCP Project ID for AksaraNetra."
  type        = string
  default     = "linear-ellipse-513814-b9"
}

variable "region" {
  description = "Primary GCP region."
  type        = string
  default     = "asia-southeast2"
}

variable "zones" {
  description = "Target zones for Regional MIG and Cloud SQL HA."
  type        = list(string)
  default     = ["asia-southeast2-a", "asia-southeast2-b"]

  validation {
    condition     = length(var.zones) >= 2
    error_message = "At least two zones are required for Regional HA and multi-zone MIG distribution."
  }
}

variable "vpc_cidr" {
  description = "CIDR range for the primary AksaraNetra application subnet."
  type        = string
  default     = "10.184.0.0/20"
}

variable "domain_name" {
  description = "Primary FQDN pointed to the Global External ALB (Cloudflare DNS-Only)."
  type        = string
  default     = "aksaranetra.rafifernanda.site"
}

variable "db_password" {
  description = "Password for the aksaranetra_user PostgreSQL account."
  type        = string
  sensitive   = true
}

variable "db_sslmode" {
  description = "PostgreSQL SSL mode consistent with Cloud SQL ENCRYPTED_ONLY."
  type        = string
  default     = "require"

  validation {
    condition     = contains(["require", "verify-ca", "verify-full"], var.db_sslmode)
    error_message = "db_sslmode must be one of require, verify-ca, or verify-full."
  }
}

variable "backend_secret" {
  description = "Shared HMAC secret (>= 32 characters) for backend token signing."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.backend_secret) >= 32
    error_message = "backend_secret must be at least 32 characters."
  }
}

variable "db_deletion_protection" {
  description = "Toggle Terraform and GCP API deletion protection on Cloud SQL."
  type        = bool
  default     = false
}

variable "min_replicas" {
  description = "Minimum VM replica count for the Regional MIG autoscaler."
  type        = number
  default     = 2
}

variable "max_replicas" {
  description = "Maximum VM replica count for the Regional MIG autoscaler."
  type        = number
  default     = 3
}

variable "machine_type" {
  description = "Compute Engine machine type for MIG nodes."
  type        = string
  default     = "e2-medium"
}

variable "artifact_registry_repo" {
  description = "Google Artifact Registry repository name holding AksaraNetra container images."
  type        = string
  default     = "aksaranetra"
}

variable "image_tag" {
  description = "Container image tag deployed by the MIG startup script."
  type        = string
  default     = "latest"
}
