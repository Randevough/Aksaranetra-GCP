output "alb_ip_address" {
  description = "Global static IPv4 address bound to the External ALB."
  value       = google_compute_global_address.alb_ip.address
}

output "certificate_id" {
  description = "Unique numeric ID of the Google-Managed SSL certificate."
  value       = google_compute_managed_ssl_certificate.managed_cert.certificate_id
}

output "certificate_name" {
  description = "Resource name of the Google-Managed SSL certificate."
  value       = google_compute_managed_ssl_certificate.managed_cert.name
}

output "certificate_expire_time" {
  description = "RFC3339 expiration timestamp (populated once Google completes DNS validation)."
  value       = google_compute_managed_ssl_certificate.managed_cert.expire_time
}

output "certificate_domains" {
  description = "SAN domains covered by the managed SSL certificate."
  value       = google_compute_managed_ssl_certificate.managed_cert.subject_alternative_names
}
