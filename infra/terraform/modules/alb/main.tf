resource "google_compute_global_address" "alb_ip" {
  project    = var.project_id
  name       = "aksaranetra-alb-ip"
  ip_version = "IPV4"
}

resource "google_compute_managed_ssl_certificate" "managed_cert" {
  project = var.project_id
  name    = "aksaranetra-managed-cert"

  managed {
    domains = [var.domain_name]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_health_check" "frontend" {
  project             = var.project_id
  name                = "aksaranetra-frontend-hc"
  description         = "Global ALB health check for Next.js frontend on port 3000."
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 3000
    request_path = "/"
  }
}

resource "google_compute_health_check" "api" {
  project             = var.project_id
  name                = "aksaranetra-api-hc"
  description         = "Global ALB health check for PHP API on port 8787."
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 8787
    request_path = "/health"
  }
}

resource "google_compute_backend_service" "frontend" {
  project               = var.project_id
  name                  = "aksaranetra-frontend-bs"
  description           = "Global ALB backend service for AksaraNetra Next.js frontend."
  protocol              = "HTTP"
  port_name             = "frontend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30
  health_checks         = [google_compute_health_check.frontend.id]

  backend {
    group           = var.mig_instance_group
    balancing_mode  = "UTILIZATION"
    max_utilization = 0.8
    capacity_scaler = 1.0
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_backend_service" "api" {
  project               = var.project_id
  name                  = "aksaranetra-api-bs"
  description           = "Global ALB backend service for AksaraNetra PHP API."
  protocol              = "HTTP"
  port_name             = "api"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 60
  health_checks         = [google_compute_health_check.api.id]

  backend {
    group           = var.mig_instance_group
    balancing_mode  = "UTILIZATION"
    max_utilization = 0.8
    capacity_scaler = 1.0
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  project         = var.project_id
  name            = "aksaranetra-https-url-map"
  description     = "Path-based routing: /api/* -> PHP API (prefix rewritten to /), default -> Next.js."
  default_service = google_compute_backend_service.frontend.id

  host_rule {
    hosts        = ["*"]
    path_matcher = "aksaranetra-paths"
  }

  path_matcher {
    name            = "aksaranetra-paths"
    default_service = google_compute_backend_service.frontend.id

    path_rule {
      paths   = ["/api", "/api/*"]
      service = google_compute_backend_service.api.id

      route_action {
        url_rewrite {
          path_prefix_rewrite = "/"
        }
      }
    }
  }
}

resource "google_compute_target_https_proxy" "https" {
  project          = var.project_id
  name             = "aksaranetra-https-proxy"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.managed_cert.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "aksaranetra-https-fr"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
  ip_address            = google_compute_global_address.alb_ip.id
}

resource "google_compute_url_map" "http_redirect" {
  project     = var.project_id
  name        = "aksaranetra-http-redirect-url-map"
  description = "Permanent 301 redirect from HTTP (port 80) to HTTPS (port 443)."

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  project = var.project_id
  name    = "aksaranetra-http-redirect-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  project               = var.project_id
  name                  = "aksaranetra-http-fr"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect.id
  ip_address            = google_compute_global_address.alb_ip.id
}
