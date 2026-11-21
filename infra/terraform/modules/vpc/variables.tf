variable "project_id" {
  description = "GCP Project ID."
  type        = string
}

variable "region" {
  description = "GCP region for subnetwork and Cloud NAT."
  type        = string
}

variable "vpc_cidr" {
  description = "Primary CIDR range for aksaranetra-app-subnet."
  type        = string
}
