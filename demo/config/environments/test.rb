# ABOUTME: Sets the test behavior for the demo Rails application.
# ABOUTME: Keeps the environment lightweight while controller integration tests run.
Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = false
  config.consider_all_requests_local = true
  config.action_controller.allow_forgery_protection = false
  config.active_support.deprecation = :stderr
end
