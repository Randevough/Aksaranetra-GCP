terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 1. Custom Log-Based Metric for Playwright Chromium Crashes & OOM Events
resource "google_logging_metric" "worker_chromium_crashes" {
  name        = "aksaranetra_worker_chromium_crashes"
  description = "Counts Playwright Headless Chromium crashes (AUDIT_BROWSER_CRASH) or container OOMKilled events across worker nodes."
  filter      = <<-EOT
    resource.type="gce_instance"
    AND (
      textPayload:("AUDIT_BROWSER_CRASH" OR "OOMKilled" OR "Target closed")
      OR jsonPayload.message:("AUDIT_BROWSER_CRASH" OR "OOMKilled")
    )
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"

    labels {
      key         = "instance_id"
      value_type  = "STRING"
      description = "Compute Engine instance emitting crash log"
    }
  }

  label_extractors = {
    "instance_id" = "EXTRACT(resource.labels.instance_id)"
  }
}

# 2. Notification Channels (Email + Discord/Telegram Webhook Relay)
resource "google_monitoring_notification_channel" "sysadmin_email" {
  display_name = "AksaraNetra Sysadmin Email"
  type         = "email"
  labels = {
    email_address = var.sysadmin_email
  }
}

resource "google_monitoring_notification_channel" "chatops_webhook" {
  display_name = "AksaraNetra Discord/Telegram Webhook"
  type         = "webhook_tokenauth"
  labels = {
    url = var.webhook_url
  }
}

# 3. Synthetic Global HTTPS Uptime Check (/api/health)
resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "AksaraNetra API Health Synthetic Check"
  timeout      = "10s"
  period       = "60s"

  selected_regions = [
    "ASIA_PACIFIC",
    "EUROPE",
    "USA"
  ]

  http_check {
    path           = "/api/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.domain_name
    }
  }

  content_matchers {
    content = "\"status\":\"ok\""
    matcher = "CONTAINS_STRING"
  }
}

# 4. Multi-Widget Observability Dashboard
resource "google_monitoring_dashboard" "aksaranetra_observability" {
  dashboard_json = jsonencode({
    displayName = "AksaraNetra Production Resilience & Observability"
    mosaicLayout = {
      columns = 12
      tiles = [
        # Widget 1: ALB Traffic by response_code_class
        {
          xPos   = 0
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "ALB Traffic (Req/s by Response Code Class)"
            xyChart = {
              dataSets = [
                {
                  plotType       = "STACKED_AREA"
                  legendTemplate = "HTTP $${metric.label.response_code_class}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" resource.type=\"https_lb_rule\" resource.label.\"url_map_name\"=\"${var.alb_url_map_name}\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_RATE"
                        crossSeriesReducer = "REDUCE_SUM"
                        groupByFields      = ["metric.label.response_code_class"]
                      }
                    }
                  }
                }
              ]
              yAxis = { label = "req/s", scale = "LINEAR" }
            }
          }
        },
        # Widget 2: ALB Backend Latency p50 / p95 / p99
        {
          xPos   = 6
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "ALB Backend Latency (p50, p95, p99 - API & Frontend)"
            xyChart = {
              dataSets = [
                {
                  plotType       = "LINE"
                  legendTemplate = "p50 - $${resource.label.backend_target_name}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"loadbalancing.googleapis.com/https/backend_latencies\" resource.type=\"https_lb_rule\" resource.label.\"url_map_name\"=\"${var.alb_url_map_name}\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_DELTA"
                        crossSeriesReducer = "REDUCE_PERCENTILE_50"
                        groupByFields      = ["resource.label.backend_target_name"]
                      }
                    }
                  }
                },
                {
                  plotType       = "LINE"
                  legendTemplate = "p95 - $${resource.label.backend_target_name}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"loadbalancing.googleapis.com/https/backend_latencies\" resource.type=\"https_lb_rule\" resource.label.\"url_map_name\"=\"${var.alb_url_map_name}\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_DELTA"
                        crossSeriesReducer = "REDUCE_PERCENTILE_95"
                        groupByFields      = ["resource.label.backend_target_name"]
                      }
                    }
                  }
                },
                {
                  plotType       = "LINE"
                  legendTemplate = "p99 - $${resource.label.backend_target_name}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"loadbalancing.googleapis.com/https/backend_latencies\" resource.type=\"https_lb_rule\" resource.label.\"url_map_name\"=\"${var.alb_url_map_name}\""
                      aggregation = {
                        alignmentPeriod    = "60s"
                        perSeriesAligner   = "ALIGN_DELTA"
                        crossSeriesReducer = "REDUCE_PERCENTILE_99"
                        groupByFields      = ["resource.label.backend_target_name"]
                      }
                    }
                  }
                }
              ]
              yAxis = { label = "ms", scale = "LINEAR" }
            }
          }
        },
        # Widget 3: Compute Engine CPU Utilization with 80% threshold
        {
          xPos   = 0
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Compute Engine CPU Utilization (Zone A vs Zone B)"
            xyChart = {
              dataSets = [
                {
                  plotType       = "LINE"
                  legendTemplate = "$${metric.label.instance_name} ($${resource.label.zone})"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"compute.googleapis.com/instance/cpu/utilization\" resource.type=\"gce_instance\" metric.label.\"instance_name\"=monitoring.regex.full_match(\"${var.vm_zone_a_name}|${var.vm_zone_b_name}\")"
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                }
              ]
              thresholds = [
                {
                  label     = "80% High CPU Threshold"
                  value     = 0.80
                  color     = "RED"
                  direction = "ABOVE"
                }
              ]
              yAxis = { label = "Ratio (0-1)", scale = "LINEAR" }
            }
          }
        },
        # Widget 4: Node Memory & Swap Pressure (Ops Agent)
        {
          xPos   = 6
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Node Memory & Swap Pressure (Playwright Chromium Watch)"
            xyChart = {
              dataSets = [
                {
                  plotType       = "LINE"
                  legendTemplate = "RAM Used % - $${resource.label.instance_id}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"agent.googleapis.com/memory/percent_used\" resource.type=\"gce_instance\" metric.label.\"state\"=\"used\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                },
                {
                  plotType       = "LINE"
                  legendTemplate = "Swap Used % - $${resource.label.instance_id}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"agent.googleapis.com/swap/percent_used\" resource.type=\"gce_instance\" metric.label.\"state\"=\"used\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                }
              ]
              thresholds = [
                {
                  label     = "85% OOM Risk Threshold"
                  value     = 85
                  color     = "RED"
                  direction = "ABOVE"
                }
              ]
              yAxis = { label = "%", scale = "LINEAR" }
            }
          }
        },
        # Widget 5: Cloud SQL PostgreSQL Connections & Disk Utilization
        {
          xPos   = 0
          yPos   = 8
          width  = 6
          height = 4
          widget = {
            title = "Cloud SQL PostgreSQL 16 HA (Active Backends & Disk %)"
            xyChart = {
              dataSets = [
                {
                  plotType       = "LINE"
                  targetAxis     = "Y1"
                  legendTemplate = "Active Connections"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\" resource.type=\"cloudsql_database\" resource.label.\"database_id\"=\"${var.project_id}:${var.cloudsql_instance_id}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                },
                {
                  plotType       = "LINE"
                  targetAxis     = "Y2"
                  legendTemplate = "Disk Utilization Ratio"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" resource.type=\"cloudsql_database\" resource.label.\"database_id\"=\"${var.project_id}:${var.cloudsql_instance_id}\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_MEAN"
                      }
                    }
                  }
                }
              ]
              yAxis  = { label = "Connections", scale = "LINEAR" }
              y2Axis = { label = "Disk Ratio", scale = "LINEAR" }
            }
          }
        },
        # Widget 6: Worker Chromium Crashes & OOMKilled Log Metric
        {
          xPos   = 6
          yPos   = 8
          width  = 6
          height = 4
          widget = {
            title = "Worker Chromium Crashes & OOMKilled Events"
            xyChart = {
              dataSets = [
                {
                  plotType       = "STACKED_BAR"
                  legendTemplate = "Crash/OOM - $${metric.label.instance_id}"
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.worker_chromium_crashes.name}\" resource.type=\"gce_instance\""
                      aggregation = {
                        alignmentPeriod  = "60s"
                        perSeriesAligner = "ALIGN_SUM"
                      }
                    }
                  }
                }
              ]
              yAxis = { label = "Events/min", scale = "LINEAR" }
            }
          }
        }
      ]
    }
  })

  depends_on = [google_logging_metric.worker_chromium_crashes]
}
