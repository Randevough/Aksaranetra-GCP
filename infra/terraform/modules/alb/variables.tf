variable "project_id" {
  description = "GCP Project ID."
  type        = string
}

variable "domain_name" {
  description = "Domain name secured by Google-Managed SSL Certificate."
  type        = string
}

variable "mig_instance_group" {
  description = "Self-link of the Regional MIG instance group."
  type        = string
}
