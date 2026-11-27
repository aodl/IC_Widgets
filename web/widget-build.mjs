export function widgetBuild() {
  const view = process.env.IC_WIDGET_EMBED_VIEW;
  const host = process.env.IC_WIDGET_HOST_ORIGIN;
  if (!view && !host) return null;
  if (!['proposal', 'subnet', 'map', 'performance'].includes(view) || !host) throw new Error('Select a widget embed view and its exact Nexus host origin.');
  const url = new URL(host);
  const mainnet = url.protocol === 'https:' && /^[a-z2-7-]+\.icp\.net$/.test(url.hostname) && !url.port;
  const local = process.env.DFX_NETWORK === 'local' && url.protocol === 'http:' && !!url.port
    && /^[a-z2-7-]+\.localhost$/.test(url.hostname);
  if (url.origin !== host || (!mainnet && !local)) throw new Error('Use an exact certified IC host origin.');
  return { view, host };
}
