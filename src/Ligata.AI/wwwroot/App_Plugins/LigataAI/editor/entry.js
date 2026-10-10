import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { UMB_ACTION_EVENT_CONTEXT } from '@umbraco-cms/backoffice/action';
import { UmbContextConsumerController } from '@umbraco-cms/backoffice/context-api';
import { UmbEntityUpdatedEvent, UmbRequestReloadStructureForEntityEvent, UmbRequestReloadChildrenOfEntityEvent } from '@umbraco-cms/backoffice/entity-action';
import './panel.js?v=0.12.2';

/**
 * Mounts the content assistant once for the whole backoffice. The panel lives on the page itself (not inside a section), so a
 * conversation goes on while the editor moves between pages; it gets the login and the backoffice's event context from here.
 * Whether it shows is decided by the server (Content assistant → Settings → Who).
 */
export const onInit = host => {
  if (document.querySelector('ligata-ai-editor-panel')) return;
  const panel = document.createElement('ligata-ai-editor-panel');
  let auth, events;
  const entityEvents = { UmbEntityUpdatedEvent, UmbRequestReloadStructureForEntityEvent, UmbRequestReloadChildrenOfEntityEvent };
  new UmbContextConsumerController(host, UMB_ACTION_EVENT_CONTEXT, context => { events = context; if (panel.auth) panel.events = context; });
  new UmbContextConsumerController(host, UMB_AUTH_CONTEXT, context => {
    if (auth) return;
    auth = context;
    document.body.append(panel);
    panel.init(auth, events, entityEvents);
  });
};

export const onUnload = () => document.querySelector('ligata-ai-editor-panel')?.remove();
