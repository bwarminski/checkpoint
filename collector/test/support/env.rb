# ABOUTME: Loads repo-root .env before collector tests run.
# ABOUTME: Preserves exported shell values and fills only missing test variables.
LINE_RE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|\s*:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/m

def load_env_file(path)
  return unless File.exist?(path)

  File.readlines(path, chomp: true).each do |line|
    parsed = parse_env_line(line)
    next unless parsed

    key, value = parsed
    ENV[key] ||= value
  end
end

def parse_env_line(line)
  match = LINE_RE.match(line.delete("\r"))
  return nil unless match

  key = match[1]
  value = (match[2] || "").strip
  unless value.empty?
    maybe_quote = value[0]
    value = value.sub(/\A(['"`])([\s\S]*)\1\z/m, '\2')
    if maybe_quote == '"'
      value = value.gsub("\\n", "\n").gsub("\\r", "\r")
    end
  end

  [key, value]
end

load_env_file(File.expand_path("../../../.env", __dir__))
