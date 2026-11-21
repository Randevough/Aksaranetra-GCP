output "dashboard_id" {
  description = "ID of the AksaraNetra Cloud Monitoring dashboard"
  value       = google_monitoring_dashboard.aksaranetra_observability.id
}

output "uptime_check_id" {
  description = "ID of the synthetic API health uptime check"
  value       = google_monitoring_uptime_check_config.api_health.uptime_check_id
}

output "alert_policy_ids" {
  description = "List of created alert policy IDs"
  value = {
    critical_ingress   = google_monitoring_alert_policy.critical_ingress_failure.id
    alb_5xx_rate       = google_monitoring_alert_policy.alb_high_5xx_rate.id
    node_memory        = google_monitoring_alert_policy.node_memory_exhaustion.id
    cloudsql_saturated = google_monitoring_alert_policy.cloudsql_connection_saturation.id
  }
}
