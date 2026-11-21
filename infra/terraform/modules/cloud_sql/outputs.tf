output "instance_name" {
  description = "Cloud SQL PostgreSQL instance name."
  value       = google_sql_database_instance.postgres.name
}

output "private_ip_address" {
  description = "Private IPv4 address allocated on the PSA peering network."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "connection_name" {
  description = "Cloud SQL instance connection name."
  value       = google_sql_database_instance.postgres.connection_name
}
