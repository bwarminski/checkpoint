# ABOUTME: Defines the demo Rails application and loads the frameworks it uses.
# ABOUTME: Keeps the app configuration minimal for the anti-pattern endpoints.
require_relative "boot"

require "rails/all"

Bundler.require(*Rails.groups)

module Demo
  class Application < Rails::Application
    config.load_defaults 7.1
    config.eager_load = false
  end
end
