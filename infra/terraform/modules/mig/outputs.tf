output "mig_id" {
  description = "Full resource ID of the Regional MIG."
  value       = google_compute_region_instance_group_manager.rmig.id
}

output "mig_name" {
  description = "Name of the Regional MIG."
  value       = google_compute_region_instance_group_manager.rmig.name
}

output "mig_instance_group" {
  description = "Instance group URL for attaching to Global ALB backend services."
  value       = google_compute_region_instance_group_manager.rmig.instance_group
}

output "mig_target_size" {
  description = "Current target size of the Regional MIG."
  value       = google_compute_region_instance_group_manager.rmig.target_size
}

output "service_account_email" {
  description = "Email of the MIG VM service account."
  value       = google_service_account.mig_sa.email
}
