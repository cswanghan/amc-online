CREATE TABLE IF NOT EXISTS resource_access_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    category      TEXT    NOT NULL,
    resource_type TEXT    NOT NULL,
    level         TEXT,
    year          INTEGER,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_resource_access_user_category
    ON resource_access_logs(user_id, category);
