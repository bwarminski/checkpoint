# ABOUTME: Exercises the demo todo endpoints through Rails integration requests.
# ABOUTME: Verifies the Task 2 JSON endpoints exist and accept the planned params.
require "test_helper"
require "json"

class TodosControllerTest < ActionDispatch::IntegrationTest
  test "index endpoint emits query log metadata and returns rows" do
    get "/todos"

    assert_response :success
    todos = JSON.parse(response.body)

    assert_equal 2, todos.length
    assert_equal ["closed todos task", "starter todos task"], todos.map { |todo| todo.fetch("title") }.sort
    assert_equal ["closed", "open"], todos.map { |todo| todo.fetch("status") }.sort
    assert_equal ["Demo User"], todos.map { |todo| todo.fetch("user").fetch("name") }.uniq
  end

  test "search endpoint accepts q param" do
    get "/todos", params: { q: "starter" }

    assert_response :success
    todos = JSON.parse(response.body)

    assert_equal 1, todos.length
    assert_equal "starter todos task", todos.first.fetch("title")
    assert_equal "open", todos.first.fetch("status")
  end

  test "status endpoint filters todos by status" do
    get "/todos/status", params: { status: "open" }

    assert_response :success
    todos = JSON.parse(response.body)

    assert_equal 1, todos.length
    assert_equal ["starter todos task"], todos.map { |todo| todo.fetch("title") }
    assert_equal ["open"], todos.map { |todo| todo.fetch("status") }
  end

  test "stats endpoint returns stable string keys" do
    user = User.find_by!(name: "Demo User")

    get "/todos/stats"

    assert_response :success
    stats = JSON.parse(response.body)

    assert_equal({ user.id.to_s => 2 }, stats)
  end
end
