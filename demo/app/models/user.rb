# ABOUTME: Represents a user that owns todo items in the demo application database.
# ABOUTME: Supports the per-user stats endpoint and eager JSON rendering in tests.
class User < ApplicationRecord
  has_many :todos
end
