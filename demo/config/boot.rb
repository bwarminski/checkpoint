# ABOUTME: Boots Bundler for the demo Rails application commands and tests.
# ABOUTME: Ensures the app resolves gems from the demo Gemfile before loading Rails.
ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup"
