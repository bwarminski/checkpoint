# ABOUTME: Defines the demo database schema used by the Rails application.
# ABOUTME: Creates the minimal users and todos tables needed for the demo endpoints.
ActiveRecord::Schema[7.1].define(version: 0) do
  create_table "users", force: :cascade do |t|
    t.string "name", null: false
    t.timestamps null: false
  end

  create_table "todos", force: :cascade do |t|
    t.string "title", null: false
    t.string "status", default: "open", null: false
    t.integer "user_id", null: false
    t.timestamps null: false
    t.index ["user_id"], name: "index_todos_on_user_id"
  end
end
