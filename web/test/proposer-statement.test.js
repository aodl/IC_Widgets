import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStatement } from '../src/proposer-statement.js';

test('proposer statements support headings and lists without creating active content or resource URLs', () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; }
    append(...children) { this.children.push(...children); }
  }
  globalThis.Node = Element;
  globalThis.document = { createElement: tag => new Element(tag) };
  const blocks = renderStatement('## Reason\n\nUse **registered** nodes.\n\n- `subnet`\n- <script>alert(1)</script>\n'
    + '- ![remote](https://example.invalid/map.svg)\n- [link](javascript:alert(1))');
  const tags = value => value instanceof Element ? [value.tag, ...value.children.flatMap(tags)] : [];
  assert.deepEqual(blocks.flatMap(tags), ['h4', 'p', 'strong', 'ul', 'li', 'code', 'li', 'li', 'li']);
  assert.match(JSON.stringify(blocks), /<script>alert\(1\)<\/script>/);
});
