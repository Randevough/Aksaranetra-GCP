output "load_balancer_ip" {
  description = "Global Static IPv4 address for Cloudflare DNS-Only A record."
  value       = module.alb.alb_ip_address
}

output "cloud_sql_private_ip" {
  description = "Private IPv4 address of the Cloud SQL PostgreSQL 16 HA instance."
  value       = module.cloud_sql.private_ip_address
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL instance connection name (project:region:instance)."
  value       = module.cloud_sql.connection_name
}

output "mig_name" {
  description = "Name of the AksaraNetra Regional Managed Instance Group."
  value       = module.mig.mig_name
}

output "mig_target_size" {
  description = "Current target size reported by the Regional MIG (managed by autoscaler)."
  value       = module.mig.mig_target_size
}

output "ssl_certificate_status" {
  description = "Google-Managed SSL certificate provisioning metadata and derived status."
  value = {
    certificate_id   = module.alb.certificate_id
    certificate_name = module.alb.certificate_name
    domains          = module.alb.certificate_domains
    expire_time      = module.alb.certificate_expire_time
    derived_status   = (module.alb.certificate_expire_time != null && module.alb.certificate_expire_time != "") ? "ACTIVE" : "PROVISIONING_OR_PENDING_DNS"
  }
}

output "artifacts_bucket_name" {
  description = "Name of the Google Cloud Storage bucket for audit artifacts."
  value       = module.gcs.bucket_name
}
