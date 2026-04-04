# ABOUTME: Verifies parsing of Rails SQL comment metadata for collector events.
# ABOUTME: Covers extraction of controller action tags and source file locations.
require "minitest/autorun"
require_relative "../lib/query_comment_parser"

class QueryCommentParserTest < Minitest::Test
  def test_parses_controller_action_and_source
    comment = "/*application:demo,controller:todos,action:index,source_location:/app/controllers/todos_controller.rb:12*/"

    parsed = QueryCommentParser.parse(comment)

    assert_equal "todos#index", parsed[:source_tag]
    assert_equal "/app/controllers/todos_controller.rb:12", parsed[:source_file]
  end

  def test_parses_live_rails_equals_format_without_source_location
    comment = "/*action='index',application='Demo',controller='todos'*/"

    parsed = QueryCommentParser.parse(comment)

    assert_equal "todos#index", parsed[:source_tag]
    assert_nil parsed[:source_file]
  end
end
