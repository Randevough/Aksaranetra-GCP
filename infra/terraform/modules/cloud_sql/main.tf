resource "google_sql_database_instance" "postgres" {
  project             = var.project_id
  name                = "aksaranetra-pg16-ha"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.db_deletion_protection

  settings {
    tier                        = "db-custom-1-3840"
    availability_type           = "REGIONAL"
    disk_size                   = 10
    disk_type                   = "PD_SSD"
    disk_autoresize             = true
    disk_autoresize_limit       = 50
    deletion_protection_enabled = var.db_deletion_protection

    location_preference {
      zone           = var.primary_zone
      secondary_zone = var.secondary_zone
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.vpc_id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "19:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }

    user_labels = {
      project        = "aksaranetra"
      psa_dependency = substr(md5(var.psa_connection_id), 0, 8)
    }
  }
}

resource "google_sql_database" "aksaranetra" {
  project   = var.project_id
  name      = "aksaranetra"
  instance  = google_sql_database_instance.postgres.name
  charset   = "UTF8"
  collation = "en_US.UTF8"
}

resource "google_sql_user" "app_user" {
  project  = var.project_id
  name     = "aksaranetra_user"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}
