-- Agent session detail: tool inputs (PII-redacted before storage).
ALTER TABLE webmcp_metric ADD COLUMN input TEXT;

-- Contact tool storage: messages agents send on behalf of users.
CREATE TABLE IF NOT EXISTS contact_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'webmcp',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
