# ABOUTME: Declares the HTTP routes for the demo todo anti-pattern endpoints.
# ABOUTME: Maps the task routes directly to the controller actions under test.
Rails.application.routes.draw do
  get "/todos", to: "todos#index"
  get "/todos/status", to: "todos#status"
  get "/todos/stats", to: "todos#stats"
end
