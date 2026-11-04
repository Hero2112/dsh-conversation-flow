/**
 * Conversation Flow — client half.
 *
 * Registers a full-page Console panel:
 *  - `sidebar.panellist` row (the icon in the left rail),
 *  - the keyed `main` panel that renders the React Flow canvas.
 *
 * The page talks to this plugin's Host half over the same-origin
 * `/conversation-flow/api/*` routes registered by index.js.
 */
import React from 'react';
import { ConversationFlowPage } from './page.jsx';
import { MESSAGES } from './shared.js';

const PANEL_ID = 'conversation-flow';
const NS = 'conversation-flow';
const PACKAGE_ID = '@local/dsh-conversation-flow';

function FlowPanelIcon({ size, active }) {
  const sizeValue = typeof size === 'number' ? size : 16;
  return (
    <svg
      width={sizeValue} height={sizeValue} viewBox="0 0 16 16" fill="none" aria-hidden="true"
      style={{ display: 'block', opacity: active ? 1 : 0.82 }}
    >
      <rect x="0.75" y="1.75" width="5.5" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.75" y="10.25" width="5.5" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <rect x="0.75" y="10.25" width="5.5" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.25 3.75h2.4a1.6 1.6 0 0 1 1.6 1.6v6.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="3.5" cy="12.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Keeps one rendering fault from blanking the whole panel slot. */
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('[conversation-flow] panel crashed', error);
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        'div',
        { style: { padding: 20, fontFamily: 'system-ui, sans-serif', fontSize: 12, color: '#e35d6a' } },
        'Conversation Flow failed to render: ' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error),
      );
    }
    return this.props.children;
  }
}

function Panel(props) {
  return React.createElement(
    PanelBoundary,
    null,
    React.createElement(ConversationFlowPage, { ctx: props.ctx }),
  );
}

export const inject = ['slots'];

export function apply(ctx) {
  const locale = ctx.get('locale');
  if (locale && typeof locale.register === 'function') {
    ctx.effect(() => {
      const disposers = [];
      if (typeof locale.register === 'function') {
        const zh = locale.register(NS, 'zh', MESSAGES.zh);
        const en = locale.register(NS, 'en', MESSAGES.en);
        disposers.push(zh, en);
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (error) {
            /* ignore */
          }
        }
      };
    }, 'conversation-flow: dictionaries');
  }

  const translate = (key) => {
    if (locale && typeof locale.bind === 'function') {
      const bound = locale.bind(NS);
      const text = bound(key);
      if (text !== key) return text;
    }
    return (MESSAGES.zh && MESSAGES.zh[key]) || key;
  };

  if (!ctx.slots || typeof ctx.slots.inject !== 'function') {
    console.error('[conversation-flow] slot service unavailable');
    return;
  }

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 45,
        label: () => translate('openGraph'),
        locale: NS,
      },
      FlowPanelIcon,
    ),
  );

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ ctx }),
      },
      Panel,
    ),
  );
}

export { PANEL_ID, NS, PACKAGE_ID };
