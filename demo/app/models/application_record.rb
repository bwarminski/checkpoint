# ABOUTME: Defines the shared ActiveRecord base class for the demo models.
# ABOUTME: Keeps model inheritance aligned with the Rails app conventions.
class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class
end
