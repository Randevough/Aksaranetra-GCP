terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.30.0"
    }
  }
}

resource "google_storage_bucket" "artifacts" {
  name                        = var.bucket_name
  project                     = var.project_id
  location                    = var.region
  storage_class               = "STANDARD"
  force_destroy               = var.force_destroy
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 7
    }
  }

  lifecycle_rule {
    action {
      type = "AbortIncompleteMultipartUpload"
    }
    condition {
      age = 1
    }
  }

  labels = {
    project     = "aksaranetra"
    managed_by  = "terraform"
    environment = "production"
    finops_ttl  = "7d"
  }
}

resource "google_storage_bucket_iam_member" "worker_access" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${var.compute_service_account_email}"
}
