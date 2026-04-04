# ABOUTME: Builds the Rails demo app image used in the local compose stack.
# ABOUTME: Installs the gems and starts the app after preparing the database.
FROM ruby:3.2.3

WORKDIR /app

RUN apt-get update \
    && apt-get install -y build-essential libpq-dev libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY Gemfile Gemfile.lock ./
RUN bundle install

COPY . .

EXPOSE 3000

CMD ["bash", "-lc", "bundle exec rails db:prepare && bundle exec rails db:seed && bundle exec rails server -b 0.0.0.0 -p 3000"]
