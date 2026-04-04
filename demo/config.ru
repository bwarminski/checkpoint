# ABOUTME: Boots the Rails app for Rack-compatible servers in the demo container.
# ABOUTME: Lets Puma serve the demo application inside the compose stack.
require_relative "config/environment"

run Rails.application
Rails.application.load_server
