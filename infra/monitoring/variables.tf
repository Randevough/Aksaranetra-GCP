variable "project_id" {
  description = "GCP Project ID for AksaraNetra"
  type        = string
  default     = "linear-ellipse-513814-b9"
}

variable "region" {
  description = "Primary GCP region"
  type        = string
  default     = "asia-southeast2"
}

variable "domain_name" {
  description = "Production HTTPS domain behind Global External ALB"
  type        = string
  default     = "aksaranetra.rafifernanda.site"
}

variable "vm_zone_a_name" {
  description = "Compute Engine instance name in asia-southeast2-a"
  type        = string
  default     = "aksaranetra-vm"
}

variable "vm_zone_b_name" {
  description = "Compute Engine instance name in asia-southeast2-b"
  type        = string
  default     = "aksaranetra-vm-b"
}

variable "cloudsql_instance_id" {
  description = "Cloud SQL PostgreSQL 16 Regional HA instance name"
  type        = string
  default     = "aksaranetra-db"
}

variable "cloudsql_max_connections" {
  description = "Configured max_connections pool limit on Cloud SQL PostgreSQL"
  type        = number
  default     = 100
}

variable "alb_url_map_name" {
  description = "GCP Global External HTTPS Load Balancer URL map name for metric scoping"
  type        = string
  default     = "aksaranetra-url-map"
}

variable "sysadmin_email" {
  description = "Email address for sysadmin incident notifications"
  type        = string
}

variable "webhook_url" {
  description = "Discord/Telegram relay webhook URL (must accept GCP Monitoring JSON)"
  type        = string
  sensitive   = true
}
