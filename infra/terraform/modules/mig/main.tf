locals {
  mig_sa_roles = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/artifactregistry.reader",
    "roles/storage.objectUser",
  ])
}

resource "google_service_account" "mig_sa" {
  project      = var.project_id
  account_id   = "aksaranetra-mig-sa"
  display_name = "AksaraNetra Regional MIG Service Account"
  description  = "Least-privilege runtime identity for AksaraNetra MIG VM instances."
}

resource "google_project_iam_member" "mig_sa_roles" {
  for_each = local.mig_sa_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.mig_sa.email}"
}

resource "google_compute_instance_template" "app" {
  project      = var.project_id
  name_prefix  = "aksaranetra-node-tmpl-"
  description  = "Immutable Ubuntu 22.04 LTS Docker host template for AksaraNetra."
  machine_type = var.machine_type
  region       = var.region

  tags = ["aksaranetra-node", "lb-backend"]

  disk {
    source_image = "ubuntu-os-cloud/ubuntu-2204-lts"
    auto_delete  = true
    boot         = true
    disk_type    = "pd-standard"
    disk_size_gb = 30
  }

  network_interface {
    subnetwork = var.subnet_id
  }

  service_account {
    email  = google_service_account.mig_sa.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE"
  }

  metadata_startup_script = templatefile("${path.module}/scripts/startup.sh", {
    project_id             = var.project_id
    region                 = var.region
    db_host                = var.db_host
    db_name                = var.db_name
    db_user                = var.db_user
    db_password            = var.db_password
    domain_name            = var.domain_name
    artifact_registry_repo = var.artifact_registry_repo
    image_tag              = var.image_tag
  })

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  labels = {
    app        = "aksaranetra"
    managed_by = "terraform"
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_iam_member.mig_sa_roles]
}

resource "google_compute_region_health_check" "autoheal" {
  project             = var.project_id
  name                = "aksaranetra-mig-autoheal-hc"
  region              = var.region
  description         = "Regional HTTP auto-healing check on PHP API /health endpoint."
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 8787
    request_path = "/health"
  }
}

resource "google_compute_region_instance_group_manager" "rmig" {
  project                          = var.project_id
  name                             = "aksaranetra-rmig"
  base_instance_name               = "aksaranetra-node"
  region                           = var.region
  distribution_policy_zones        = var.zones
  distribution_policy_target_shape = "EVEN"

  version {
    name              = "primary"
    instance_template = google_compute_instance_template.app.self_link_unique
  }

  named_port {
    name = "frontend"
    port = 3000
  }

  named_port {
    name = "api"
    port = 8787
  }

  named_port {
    name = "http"
    port = 80
  }

  auto_healing_policies {
    health_check      = google_compute_region_health_check.autoheal.id
    initial_delay_sec = 300
  }

  update_policy {
    type                         = "PROACTIVE"
    minimal_action               = "REPLACE"
    instance_redistribution_type = "PROACTIVE"
    replacement_method           = "SUBSTITUTE"
    max_surge_fixed              = length(var.zones)
    max_unavailable_fixed        = 0
  }

  instance_lifecycle_policy {
    force_update_on_repair = "YES"
  }
}

resource "google_compute_region_autoscaler" "rmig_autoscaler" {
  project = var.project_id
  name    = "aksaranetra-rmig-autoscaler"
  region  = var.region
  target  = google_compute_region_instance_group_manager.rmig.id

  autoscaling_policy {
    min_replicas    = var.min_replicas
    max_replicas    = var.max_replicas
    cooldown_period = 120

    cpu_utilization {
      target = 0.70
    }
  }
}
