# ABOUTME: Parses Rails SQL comment tags into source metadata for collector rows.
# ABOUTME: Extracts controller-action tags and source file locations from comments.
class QueryCommentParser
  def self.parse(comment)
    pairs = comment.to_s.delete_prefix("/*").delete_suffix("*/").split(",").map { |part| part.split(":", 2) }.to_h
    {
      source_tag: [pairs["controller"], pairs["action"]].compact.join("#"),
      source_file: pairs["source_location"]
    }
  end
end
