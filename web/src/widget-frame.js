// Network Nexus draft 0.1. The deployment pins the host origin at build time.
const protocol = 'network-nexus/0.1';
function bounded(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= 131072;
  } catch {
    return false;
  }
}

export function acceptNexusHost(origin, configure) {
  let session, instance, currentPort;
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== origin || parent === window) return;
    const message = event.data;
    if (message?.protocol !== protocol || typeof message.session !== 'string' || message.session.length > 80
      || typeof message.instance !== 'string' || message.instance.length > 80) return;
    if (message.type === 'hello') {
      if (message.session !== session || message.instance !== instance) {
        currentPort?.close();
        currentPort = undefined;
        ({ session, instance } = message);
      }
      if (!currentPort) parent.postMessage({ protocol, type: 'ready', session, instance }, origin);
    } else if (message.type === 'channel' && !currentPort && message.session === session && message.instance === instance
      && event.ports.length === 1) {
      const port = currentPort = event.ports[0];
      let generation = 0;
      let sequence = 0;
      port.onmessage = event => {
        const input = event.data;
        if (port !== currentPort || input?.protocol !== protocol || input.type !== 'configure'
          || input.session !== session || input.instance !== instance || !Number.isSafeInteger(input.generation)
          || input.generation <= generation || !input.values || !bounded(input)) return;
        generation = input.generation;
        sequence = 0;
        const active = () => port === currentPort && generation === input.generation;
        configure(input.values, values => {
          if (active() && bounded(values)) port.postMessage({
            protocol, type: 'outputs.replace', session, instance, generation, sequence: ++sequence, values,
          });
        });
      };
    }
  });
}
