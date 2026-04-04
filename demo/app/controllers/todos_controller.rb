# ABOUTME: Serves the demo todo endpoints that intentionally expose query anti-patterns.
# ABOUTME: Returns todo, status, and per-user stats data for the local collector demo.
class TodosController < ApplicationController
  def index
    todos = params[:q].present? ? Todo.where("title LIKE ?", "%#{params[:q]}%") : Todo.all
    render json: todos.as_json(include: :user)
  end

  def status
    render json: Todo.where(status: params.fetch(:status, "open"))
  end

  def stats
    render json: User.all.index_with { |user| user.todos.count }.transform_keys { |user| user.id.to_s }
  end
end
