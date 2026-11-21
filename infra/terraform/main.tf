module "vpc" {
  source = "./modules/vpc"

  project_id = var.project_id
  region     = var.region
  vpc_cidr   = var.vpc_cidr
}

module "cloud_sql" {
  source = "./modules/cloud_sql"

  project_id             = var.project_id
  region                 = var.region
  primary_zone           = var.zones[0]
  secondary_zone         = var.zones[1]
  vpc_id                 = module.vpc.vpc_id
  psa_connection_id      = module.vpc.psa_connection_id
  db_password            = var.db_password
  db_deletion_protection = var.db_deletion_protection

  depends_on = [module.vpc]
}

module "mig" {
  source = "./modules/mig"

  project_id             = var.project_id
  region                 = var.region
  zones                  = var.zones
  subnet_id              = module.vpc.subnet_id
  machine_type           = var.machine_type
  min_replicas           = var.min_replicas
  max_replicas           = var.max_replicas
  db_host                = module.cloud_sql.private_ip_address
  db_name                = "aksaranetra"
  db_user                = "aksaranetra_user"
  db_password            = var.db_password
  domain_name            = var.domain_name
  artifact_registry_repo = var.artifact_registry_repo
  image_tag              = var.image_tag

  depends_on = [module.vpc, module.cloud_sql]
}

module "alb" {
  source = "./modules/alb"

  project_id         = var.project_id
  domain_name        = var.domain_name
  mig_instance_group = module.mig.mig_instance_group

  depends_on = [module.mig]
}

module "gcs" {
  source = "./modules/gcs"

  project_id                    = var.project_id
  region                        = var.region
  bucket_name                   = "aksaranetra-artifacts-${var.project_id}"
  compute_service_account_email = module.mig.service_account_email
  force_destroy                 = true

  depends_on = [module.mig]
}
