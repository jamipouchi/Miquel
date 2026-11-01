-- AXO-style agent analytics: sessions, agent identification, error detail.
ALTER TABLE webmcp_metric ADD COLUMN session TEXT;
ALTER TABLE webmcp_metric ADD COLUMN agent TEXT;
ALTER TABLE webmcp_metric ADD COLUMN error TEXT;

CREATE INDEX IF NOT EXISTS idx_webmcp_metric_session ON webmcp_metric(session);
CREATE INDEX IF NOT EXISTS idx_webmcp_metric_tool ON webmcp_metric(tool);
