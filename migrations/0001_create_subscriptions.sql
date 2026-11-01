CREATE TABLE IF NOT EXISTS user (
  email TEXT NOT NULL PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    slug TEXT NOT NULL,
    UNIQUE(user_email, slug),
    FOREIGN KEY (user_email) REFERENCES user(email)
);

CREATE INDEX IF NOT EXISTS idx_subscription_slug ON subscription(slug);

