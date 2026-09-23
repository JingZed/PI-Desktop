/**
 * Demo styles for the ui-slots example plugin. Injected once at load and
 * torn down by the host on unload. Scoped under this plugin's slot chrome.
 */
export function applyDemoStyles(pi) {
  const cssId = pi.plugin.id.replace(/[^A-Za-z0-9_-]/g, "-");
  const scope = `.pi-plugin-slot.${cssId}`;
  pi.ui.injectStyle(`
${scope} .slot-demo-card {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
  font-size: 12.5px;
  line-height: 1.55;
}
${scope} .slot-demo-card h4 {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}
${scope} .slot-demo-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
}
${scope} .slot-demo-title-row h4 {
  margin: 0;
}
${scope} .slot-demo-own {
  padding: 0 7px;
  border-radius: 99px;
  background: rgb(64 201 119 / 0.14);
  color: #40c977;
  font-size: 10px;
  letter-spacing: 0.04em;
}
${scope} .slot-demo-btn {
  padding: 2px 10px;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
${scope} .slot-demo-btn:hover {
  background: rgb(255 255 255 / 0.08);
}
${scope} .slot-demo-plugin-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 0;
  border-radius: 99px;
  font: inherit;
  font-size: 11.5px;
  color: var(--ds-accent, #c27aff);
  background: color-mix(in oklab, var(--ds-accent, #c27aff) 12%, transparent);
  cursor: pointer;
}
${scope} .slot-demo-plugin-btn:hover {
  background: color-mix(in oklab, var(--ds-accent, #c27aff) 20%, transparent);
}
${scope} .slot-demo-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 99px;
  background: transparent;
  color: var(--ds-text-secondary, #b0b0b0);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
${scope} .slot-demo-bar-btn:hover {
  background: rgb(255 255 255 / 0.06);
}
${scope} .slot-demo-run-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
${scope} .slot-demo-run-row code {
  flex: 1;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
}
${scope} .slot-demo-rows {
  display: grid;
  gap: 2px;
  margin-top: 6px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
}
${scope} .slot-demo-spark {
  display: block;
  width: 100%;
  height: 54px;
}
${scope} .slot-demo-sql {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.28);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
}
${scope} .slot-demo-error {
  color: #ff6764;
}
${scope} .slot-demo-table {
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
  font-size: 11.5px;
}
${scope} .slot-demo-table th {
  padding: 3px 8px;
  border-bottom: 1px solid rgb(255 255 255 / 0.1);
  color: var(--ds-text-muted, #7d7d7d);
  font-weight: 500;
  text-align: left;
}
${scope} .slot-demo-table td {
  padding: 3px 8px;
  border-bottom: 1px solid rgb(255 255 255 / 0.05);
}
${scope} .slot-demo-table .num {
  text-align: right;
  font-family: ui-monospace, Consolas, monospace;
}
${scope} .slot-demo-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--ds-text-secondary, #b0b0b0);
}
${scope} .slot-demo-legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
}
${scope} .slot-demo-term-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
${scope} .slot-demo-term {
  padding: 2px 7px;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.07);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
}
${scope} .slot-demo-translation {
  padding: 9px 11px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.05);
  font-size: 12px;
  line-height: 1.55;
}
${scope} .slot-demo-notice-body {
  flex: 1;
  display: grid;
  gap: 1px;
  text-align: left;
}
${scope} .slot-demo-notice-title {
  font-size: 12.5px;
  font-weight: 600;
}
${scope} .slot-demo-notice-msg {
  font-size: 11.5px;
  color: var(--ds-text-secondary, #b0b0b0);
}
${scope} .slot-demo-trigger {
  display: grid;
  gap: 4px;
}
${scope} .slot-demo-token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
${scope} .slot-demo-token .tok {
  color: var(--ds-accent, #c27aff);
  font-weight: 600;
}
`);
}
