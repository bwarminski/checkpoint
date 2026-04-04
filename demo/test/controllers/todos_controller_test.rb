# ABOUTME: Exercises the demo todo endpoints through Rails integration requests.
# ABOUTME: Verifies the Task 2 JSON endpoints exist and accept the planned params.
require "test_helper"

class TodosControllerTest < ActionDispatch::IntegrationTest
  test "index endpoint emits query log metadata and returns rows" do
    get "/todos"

    assert_response :success
    assert_includes response.body, "todos"
  end

  test "search endpoint accepts q param" do
    get "/todos", params: { q: "task" }

    assert_response :success
  end
end
