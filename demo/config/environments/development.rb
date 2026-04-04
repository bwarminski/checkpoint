# ABOUTME: Sets the development behavior for the demo Rails application.
# ABOUTME: Enables ActiveRecord query log tags so the collector can trace sources.
Rails.application.configure do
  config.enable_reloading = true
  config.eager_load = false
  config.consider_all_requests_local = true
  config.active_support.deprecation = :log
  config.active_record.query_log_tags_enabled = true
  config.active_record.query_log_tags = [:application, :controller, :action, :source_location]
end
