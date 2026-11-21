variable "project_id" {
  description = "GCP Project ID."
  type        = string
}

variable "region" {
  description = "GCP region for the Regional MIG."
  type        = string
}

variable "zones" {
  description = "Distribution zones for Regional MIG instances."
  type        = list(string)
}

variable "subnet_id" {
  description = "Private subnetwork ID for MIG nodes."
  type        = string
}

variable "machine_type" {
  description = "Compute Engine machine type."
  type        = string
}

variable "min_replicas" {
  description = "Autoscaler minimum replica count."
  type        = number
}

variable "max_replicas" {
  description = "Autoscaler maximum replica count."
  type        = number
}

variable "db_host" {
  description = "Private IP address of Cloud SQL PostgreSQL."
  type        = string
}

variable "db_name" {
  description = "PostgreSQL database name."
  type        = string
}

variable "db_user" {
  description = "PostgreSQL application username."
  type        = string
}

variable "db_password" {
  description = "PostgreSQL application password."
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Public HTTPS domain name for AksaraNetra."
  type        = string
}

variable "artifact_registry_repo" {
  description = "Artifact Registry repository name."
  type        = string
}

variable "image_tag" {
  description = "Docker image tag to deploy."
  type        = string
}
