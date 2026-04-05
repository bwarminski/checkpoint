# ABOUTME: Loads repo-root .env before collector tests run.
# ABOUTME: Preserves exported shell values and fills only missing test variables.
def load_env_file(path)
  return unless File.exist?(path)

  File.readlines(path, chomp: true).each do |line|
    stripped = line.strip
    next if stripped.empty? || stripped.start_with?("#") || !stripped.include?("=")

    key, value = stripped.split("=", 2)
    ENV[key] ||= value
  end
end

load_env_file(File.expand_path("../../../.env", __dir__))
