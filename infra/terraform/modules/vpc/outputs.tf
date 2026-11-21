output "vpc_id" {
  description = "Resource ID of the AksaraNetra VPC."
  value       = google_compute_network.vpc.id
}

output "vpc_name" {
  description = "Name of the AksaraNetra VPC."
  value       = google_compute_network.vpc.name
}

output "subnet_id" {
  description = "Resource ID of the private application subnetwork."
  value       = google_compute_subnetwork.app_subnet.id
}

output "psa_connection_id" {
  description = "Service Networking PSA peering connection ID."
  value       = google_service_networking_connection.psa_connection.id
}
