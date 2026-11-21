locals {
  notification_channels = [
    google_monitoring_notification_channel.sysadmin_email.id,
    google_monitoring_notification_channel.chatops_webhook.id,
  ]
  db_connection_threshold = floor(var.cloudsql_max_connections * 0.80)
}

# Policy 1: Critical Ingress Failure (Uptime Check fails > 1 min across >= 2 regions)
resource "google_monitoring_alert_policy" "critical_ingress_failure" {
  display_name = "[P0] AksaraNetra Critical Ingress Failure (/api/health)"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "Uptime check failing across 2 or more global regions"
    condition_threshold {
      filter = <<-EOT
        metric.type="monitoring.googleapis.com/uptime_check/check_passed"
        AND resource.type="uptime_url"
        AND metric.label."check_id"="${google_monitoring_uptime_check_config.api_health.uptime_check_id}"
      EOT

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "60s"

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    mime_type = "text/markdown"
    content   = "AksaraNetra `/api/health` failed synthetic checks from at least 2 global regions for over 1 minute. Verify Global HTTPS ALB backend health and both Compute Engine nodes (`aksaranetra-vm`, `aksaranetra-vm-b`)."
  }
}

# Policy 2: High Error Rate (ALB HTTP 5xx > 2% over 5-minute rolling window)
resource "google_monitoring_alert_policy" "alb_high_5xx_rate" {
  display_name = "[P1] AksaraNetra ALB HTTP 5xx Rate Above 2%"
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "ALB 5xx error ratio exceeds 2% over 5m window"
    condition_threshold {
      filter = <<-EOT
        metric.type="loadbalancing.googleapis.com/https/request_count"
        AND resource.type="https_lb_rule"
        AND resource.label."url_map_name"="${var.alb_url_map_name}"
        AND metric.label."response_code_class"="500"
      EOT

      denominator_filter = <<-EOT
        metric.type="loadbalancing.googleapis.com/https/request_count"
        AND resource.type="https_lb_rule"
        AND resource.label."url_map_name"="${var.alb_url_map_name}"
      EOT

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      denominator_aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      comparison      = "COMPARISON_GT"
      threshold_value = 0.02
      duration        = "0s"

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    mime_type = "text/markdown"
    content   = "HTTP 5xx error ratio exceeded 2% across a 5-minute rolling window on `${var.alb_url_map_name}`. Inspect backend-api container logs and Cloud SQL connectivity."
  }
}

# Policy 3: Node Memory Exhaustion (> 85% RAM for > 3 minutes)
resource "google_monitoring_alert_policy" "node_memory_exhaustion" {
  display_name = "[P1] AksaraNetra Node Memory Exhaustion (>85% RAM)"
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "Ops Agent memory percent_used exceeds 85% for 3 minutes"
    condition_threshold {
      filter = <<-EOT
        metric.type="agent.googleapis.com/memory/percent_used"
        AND resource.type="gce_instance"
        AND metric.label."state"="used"
      EOT

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }

      comparison      = "COMPARISON_GT"
      threshold_value = 85
      duration        = "180s"

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    mime_type = "text/markdown"
    content   = "Instance memory usage exceeded 85% for 3 consecutive minutes. Risk of Playwright Headless Chromium OOMKilled event. Verify `--max-old-space-size=192` and swap pressure."
  }
}

# Policy 4: Database Connection Saturation (> 80% of max pool)
resource "google_monitoring_alert_policy" "cloudsql_connection_saturation" {
  display_name = "[P1] AksaraNetra Cloud SQL Connection Saturation (>80%)"
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "Cloud SQL PostgreSQL active backends exceed 80% of max_connections"
    condition_threshold {
      filter = <<-EOT
        metric.type="cloudsql.googleapis.com/database/postgresql/num_backends"
        AND resource.type="cloudsql_database"
        AND resource.label."database_id"="${var.project_id}:${var.cloudsql_instance_id}"
      EOT

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }

      comparison      = "COMPARISON_GT"
      threshold_value = local.db_connection_threshold
      duration        = "120s"

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.notification_channels

  documentation {
    mime_type = "text/markdown"
    content   = "PostgreSQL active backend connections exceeded ${local.db_connection_threshold} (80% of max_connections=${var.cloudsql_max_connections}) on `${var.cloudsql_instance_id}`."
  }
}
