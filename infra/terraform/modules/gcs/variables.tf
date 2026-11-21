variable "project_id" {
  description = "GCP Project ID hosting the AksaraNetra artifact bucket."
  type        = string
  default     = "linear-ellipse-513814-b9"
}

variable "region" {
  description = "GCP region for the regional GCS bucket."
  type        = string
  default     = "asia-southeast2"
}

variable "bucket_name" {
  description = "Globally unique name for the private AksaraNetra artifacts bucket."
  type        = string
  default     = "aksaranetra-artifacts-linear-ellipse-513814-b9"
}

variable "compute_service_account_email" {
  description = "Email of the Regional MIG VM-attached Service Account."
  type        = string
  default     = "aksaranetra-mig-sa@linear-ellipse-513814-b9.iam.gserviceaccount.com"
}

variable "force_destroy" {
  description = "Allow Terraform to destroy the bucket even if objects remain (enabled for UTS demo teardown)."
  type        = bool
  default     = true
}
