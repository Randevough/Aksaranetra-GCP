resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "aksaranetra-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "app_subnet" {
  project                  = var.project_id
  name                     = "aksaranetra-app-subnet"
  ip_cidr_range            = var.vpc_cidr
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
}

resource "google_compute_global_address" "psa_range" {
  project       = var.project_id
  name          = "aksaranetra-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa_range.name]
  deletion_policy         = "ABANDON"
}

resource "google_compute_router" "nat_router" {
  project = var.project_id
  name    = "aksaranetra-nat-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "cloud_nat" {
  project                            = var.project_id
  name                               = "aksaranetra-cloud-nat"
  router                             = google_compute_router.nat_router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_compute_firewall" "allow_lb_health_checks" {
  project     = var.project_id
  name        = "aksaranetra-allow-lb-hc"
  network     = google_compute_network.vpc.name
  description = "Allow Google Cloud Load Balancer proxies and health check probes."
  direction   = "INGRESS"
  priority    = 1000

  source_ranges = [
    "130.211.0.0/22",
    "35.191.0.0/16",
  ]

  target_tags = ["lb-backend"]

  allow {
    protocol = "tcp"
    ports    = ["80", "3000", "8787"]
  }
}

resource "google_compute_firewall" "allow_iap_ssh" {
  project     = var.project_id
  name        = "aksaranetra-allow-iap-ssh"
  network     = google_compute_network.vpc.name
  description = "Allow SSH exclusively via Identity-Aware Proxy (Cloud IAP)."
  direction   = "INGRESS"
  priority    = 1000

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["aksaranetra-node"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "allow_internal" {
  project     = var.project_id
  name        = "aksaranetra-allow-internal"
  network     = google_compute_network.vpc.name
  description = "Allow intra-subnet communication between AksaraNetra workloads."
  direction   = "INGRESS"
  priority    = 1000

  source_ranges = [var.vpc_cidr]

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "icmp"
  }
}
