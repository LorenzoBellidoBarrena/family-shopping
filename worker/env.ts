export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  HOUSEHOLD_COORDINATOR: DurableObjectNamespace;
  HOUSEHOLD_ACCESS_KEY?: string;
  IMPORT_ADMIN_KEY?: string;
  SUPERMARKET_FEATURE_ENABLED?: string;
}
