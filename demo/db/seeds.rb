# ABOUTME: Loads the baseline demo records for the Rails anti-pattern endpoints.
# ABOUTME: Creates stable todo rows so tests and local setup return visible JSON data.
user = User.find_or_create_by!(name: "Demo User")

Todo.find_or_create_by!(title: "starter todos task", user: user) do |todo|
  todo.status = "open"
end

Todo.find_or_create_by!(title: "closed todos task", user: user) do |todo|
  todo.status = "closed"
end
