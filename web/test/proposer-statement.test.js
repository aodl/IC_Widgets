import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStatement, statementExcerpt } from '../src/proposer-statement.js';

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

test('the summary leads with the proposer’s stated reason and leaves technical appendices in full text', () => {
  assert.equal(statementExcerpt({ title: 'Replace a node', text: '# Replace a node\n\nMotivation: Decommission a site.\nTechnical appendix begins on the next line.\n\n## Comparison\nAppendix' }),
    'Decommission a site.');
});
