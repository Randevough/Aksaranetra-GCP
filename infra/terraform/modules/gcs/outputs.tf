output "bucket_name" {
  description = "Name of the provisioned GCS artifacts bucket."
  value       = google_storage_bucket.artifacts.name
}

output "bucket_url" {
  description = "gs:// URI of the provisioned GCS artifacts bucket."
  value       = google_storage_bucket.artifacts.url
}

output "bucket_self_link" {
  description = "Self link of the provisioned GCS artifacts bucket."
  value       = google_storage_bucket.artifacts.self_link
}
