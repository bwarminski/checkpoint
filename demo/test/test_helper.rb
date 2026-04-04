# ABOUTME: Boots Rails test support for the demo application integration tests.
# ABOUTME: Loads schema-backed seed data so the Task 2 endpoint assertions see rows.
ENV["RAILS_ENV"] ||= "test"

require_relative "../config/environment"
require "rails/test_help"

load Rails.root.join("db/schema.rb") unless ActiveRecord::Base.connection.data_source_exists?("users")
Rails.application.load_seed

class ActiveSupport::TestCase
  parallelize(workers: 1)
end
