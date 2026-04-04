# ABOUTME: Represents a single todo item in the demo application database.
# ABOUTME: Connects each todo to the owning user for the query log examples.
class Todo < ApplicationRecord
  belongs_to :user
end
