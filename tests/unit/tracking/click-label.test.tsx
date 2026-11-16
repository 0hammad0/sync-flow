import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { labelOf, targetOf, watch } from '@/features/tracking/client/clicks';
import type { ClickInput } from '@/features/tracking/client/tracker';

/**
 * Click privacy (07-tracker.md "Privacy rules in code"): the label is the
 * visible text of a button or link only, ≤ 40 chars, and is dropped inside
 * inputs, textareas, contenteditable and `[data-private]` (the chat message
 * list). Targets are `data-track` ids or tag selectors, never ids or text.
 */

const ROOT = resolve(__dirname, '../../..');
const html = (markup: string) => {
  document.body.innerHTML = markup;
};
const q = (selector: string) => document.querySelector(selector)!;

describe('labelOf', () => {
  it('keeps the visible text of a data-track element, whitespace collapsed, ≤ 40 chars', () => {
    html(`<button id="b" data-track="room-create">  Start
      a room </button><a id="a" data-track="x" href="/x">${'Long link text '.repeat(5)}</a>`);
    expect(labelOf(q('#b'), q('#b'))).toBe('Start a room');
    expect(labelOf(q('#a'), q('#a'))!.length).toBeLessThanOrEqual(40);
  });

  it('labels are opt-in: a link or button without its own data-track has no label', () => {
    // Recent-rooms link on /chat: the room name and code are user data.
    html('<ul><li><a id="room" href="/chat/ABCD2345">Team standup ABCD2345 · 3h left</a></li></ul>');
    expect(labelOf(q('#room'), q('#room'))).toBeNull();
    // A received URL on /receive.
    html('<a id="url" href="https://x.example/t/secret" target="_blank">https://x.example/t/secret</a>');
    expect(labelOf(q('#url'), q('#url'))).toBeNull();
    // A data-track container does not lend its opt-in to links inside it.
    html('<div data-track="list"><a id="in" href="/chat/ABCD2345">Team standup</a></div>');
    expect(labelOf(q('#in'), q('#in'))).toBeNull();
  });

  it('never uses aria-label (it can hold a file name)', () => {
    html('<button id="b" data-track="x" aria-label="Remove holiday-photos.zip"><svg></svg></button>');
    expect(labelOf(q('#b'), q('#b'))).toBeNull();
  });

  it.each([
    ['inside an input wrapper', '<label><input id="from"><button id="el" data-track="x">Go</button></label>', '#el', '#from'],
    ['in a textarea', '<div role="button" id="el" data-track="x"><textarea id="from">typed secret</textarea></div>', '#el', '#from'],
    ['in contenteditable', '<div contenteditable id="ce"><a href="/x" id="el" data-track="x">my note</a></div>', '#el', '#el'],
    ['in [data-private]', '<section data-private><button id="el" data-track="x">Hello Ali, see you</button></section>', '#el', '#el'],
    ['button holding a private part', '<button id="el" data-track="x"><span data-private>file.pdf</span> Download</button>', '#el', '#el'],
  ])('drops the label %s', (_, markup, el, from) => {
    html(markup);
    expect(labelOf(q(el), q(from))).toBeNull();
  });

  it('drops every label inside the chat message list (data-private on its root)', () => {
    const room = readFileSync(resolve(ROOT, 'src/features/chat/components/ChatRoom.tsx'), 'utf8');
    // The scroll container of the messages carries data-private.
    expect(room).toMatch(/data-chat-scroll[\s\S]{0,200}data-private/);
    html(`<div data-chat-scroll data-private><div><p>meet at 5</p><a id="link" data-track="x" href="https://x.example">https://x.example/secret</a><button id="copy" data-track="link-copy">Copy</button></div></div>`);
    expect(labelOf(q('#link'), q('#link'))).toBeNull();
    expect(labelOf(q('#copy'), q('#copy'))).toBeNull();
  });
});

describe('targetOf', () => {
  it('uses the data-track id of the element or an ancestor', () => {
    html('<div data-track="room-create"><button id="b"><span id="s">Start</span></button></div>');
    expect(targetOf(q('#b'))).toBe('room-create');
  });

  it('else a short tag selector, without ids, classes or text', () => {
    html('<main><nav><a href="/">A</a><a id="secret-AB12CD" class="x" href="/b">B</a></nav></main>');
    const target = targetOf(q('#secret-AB12CD'));
    expect(target).toBe('main > nav > a:nth-of-type(2)');
    expect(target).not.toMatch(/AB12CD|secret|\.x/);
  });

  it('caps at 120 characters', () => {
    html(`<button id="b" data-track="${'t'.repeat(300)}">x</button>`);
    expect(targetOf(q('#b'))).toHaveLength(120);
  });
});

describe('capture (pointerup → event)', () => {
  const sent: ClickInput[] = [];

  beforeAll(() => {
    watch((e) => sent.push(e));
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    sent.length = 0;
  });

  const up = (el: Element, init: MouseEventInit = {}) =>
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, ...init }));

  it('a button click sends a click event with label and target, no typed text', () => {
    html('<div><input id="in" value="my password"><button id="b" data-track="chat-send">Send</button></div>');
    up(q('#b'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'click', target: 'chat-send', label: 'Send' });
    expect(JSON.stringify(sent)).not.toContain('my password');
  });

  it('clicks outside a/button/[role=button]/[data-track] are ignored', () => {
    html('<p id="p">plain text</p>');
    up(q('#p'));
    expect(sent).toHaveLength(0);
  });

  it('message list click: the event goes out without any label', () => {
    html('<div data-chat-scroll data-private><a id="l" href="/x">secret message link</a></div>');
    up(q('#l'));
    expect(sent).toHaveLength(1);
    expect(sent[0].label).toBeNull();
    expect(JSON.stringify(sent)).not.toContain('secret');
  });

  it('secondary buttons are ignored', () => {
    html('<button id="b">Send</button>');
    up(q('#b'), { button: 2 });
    expect(sent).toHaveLength(0);
  });

  it('reads no layout per click: no getBoundingClientRect, scrollWidth or scrollHeight', () => {
    html('<button id="b">Send</button>');
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const width = vi.spyOn(document.documentElement, 'scrollWidth', 'get');
    const height = vi.spyOn(document.documentElement, 'scrollHeight', 'get');
    up(q('#b'));
    expect(sent.filter((e) => e.type === 'click')).toHaveLength(1); // the same spot as earlier tests: a rage event may follow
    expect(rect).not.toHaveBeenCalled();
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
  });
});
