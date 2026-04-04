from pathlib import Path


def test_blog_post_mentions_explain_diff_and_hypopg():
    text = Path("docs/blog/db-specialist-agent-post.md").read_text()
    assert "EXPLAIN" in text
    assert "HypoPG" in text
