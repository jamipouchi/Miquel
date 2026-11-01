# incidentd - Architecture

`incidentd` was built around a simple idea: \
**strong atomic guarantees + durable eventual consistency**, independent of where inputs come from or where side-effects go.

It must be incident-free.

`incidentd` is a standalone service that manages an incident end-to-end: from declaration to resolution. It owns state, notifications, AI suggestions, status page updates, and post-incident analysis.

From day one, it was designed to feed context into AI agents. That means data lives close, and reads/writes are fast.

## Platform

`incidentd` runs on Cloudflare Workers, using 3 primitives:

- **Durable Objects** -> per-incident transactional state
- **D1** -> queryable indexing and listing
- **Workflows** -> async side effects and AI jobs

Working on Cloudflare has been surprisingly good: great DX, trivial deployment and low cost.

The only real downside is ISPs blocking thanks to a spectacularly bad ruling that gave power to LaLiga to control the internet. (irrelevant in this case since this is server-to-server)

## The Durable Object

Each incident maps to a single Durable Object.

This is the source of truth for:

- Event timeline (`event_log`)
- Derived state: status, severity, assignee, metadata

Every mutation follows the same pattern:

1. Start transaction
2. Update state
3. Append event (`published_at = NULL`)
4. Schedule alarm
5. Commit

This is the **outbox pattern**.

The core idea behind `incidentd` is:
> A single-threaded, transactional system that gives you atomicity and reliable async delivery, without distributed coordination.

### Alarm-based delivery

The DO alarm drains unpublished events:

```
for each event where published_at IS NULL and attempts < 3:
    dispatch to IncidentWorkflow
    set published_at = now
```

If dispatch fails, it retries. After 3 attempts, the event is marked failed but acknowledged. \
This gives at-least-once delivery with bounded retries.

The same alarm also drives agent scheduling. A single method `decideAlarmAction()` decides what to do next:
- dispatch events
- trigger an agent turn
- schedule cleanup
- or do nothing

This keeps the reliability story local: one place decides what must happen next, and one durable log says what already happened.

### The dispatcher

`IncidentWorkflow` bridges the incident Durable Object and the senders.
It's a long-lived workflow that processes events in order:

```
dispatch first event
while incident is not resolved or declined:
    wait for next event
    dispatch it
```

Each event is fanned out to all senders using `Promise.allSettled`.
- A failing sender doesn't block others
- Failures are logged, not fatal

Because delivery is at-least-once, senders should be idempotent (`incident_id` + `event_id`).

Events are committed sequentially in the DO, and dispatched in the same order. \
No races, no inconsistent external state.

### Why not Queues?

Queues have a classic problem: **dual-writes**.
Update state in one system, enqueue in another. If enqueue fails, the event is lost.

It can be fixed (outbox tables, polling, distributed transactions), but complexity explodes.

Here, the outbox lives inside the Durable Object, and dispatch goes directly to a workflow.

Also:

> Workflows are basically queues with better ergonomics

So I use them.

### IDs and identifiers

- Internal IDs: newUniqueId() → stored in D1
- DO resolution: idFromString
- External IDs: Slack, dashboard, etc. → stored as routing metadata

Originally I used idFromName (e.g. Slack thread ID), but that made IDs non-reusable after resolution.

## The plugin model

The system is structured as:
**receivers → handler → durable object → dispatcher → senders**

<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1407.3340999271354 289.53139701580017" width="700" height="170"><!-- svg-source:excalidraw --><metadata></metadata><defs><style class="style-fonts">
      @font-face { font-family: Excalifont; src: url(data:font/woff2;base64,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); }</style></defs><g stroke-linecap="round" transform="translate(162.86294570021062 153.13158947275463) rotate(0 83.85032214759786 48.6463662859768)"><path d="M24.32 0 C51.79 -0.4, 78.64 -0.31, 143.38 0 M24.32 0 C72.65 1.35, 119.78 0.8, 143.38 0 M143.38 0 C158.65 -0.54, 165.9 8.64, 167.7 24.32 M143.38 0 C158.02 -1.33, 169.34 8.28, 167.7 24.32 M167.7 24.32 C168.2 41.84, 169.33 59.44, 167.7 72.97 M167.7 24.32 C167.98 36.2, 169.01 49.44, 167.7 72.97 M167.7 72.97 C169.08 90.45, 159.29 98.37, 143.38 97.29 M167.7 72.97 C166.86 88.73, 160.44 98.6, 143.38 97.29 M143.38 97.29 C106.29 94.53, 68.7 97.8, 24.32 97.29 M143.38 97.29 C113.8 96.41, 81.48 95.55, 24.32 97.29 M24.32 97.29 C7.49 99.24, 1.62 89.58, 0 72.97 M24.32 97.29 C8.81 96, -0.23 90.32, 0 72.97 M0 72.97 C-0.77 57.45, -0.73 44.65, 0 24.32 M0 72.97 C-0.41 57.98, -0.24 42.85, 0 24.32 M0 24.32 C-0.66 8.04, 7.87 0.53, 24.32 0 M0 24.32 C-0.35 6.47, 8.87 1.99, 24.32 0" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(214.4572940318905 191.77795575873142) rotate(0 32.25597381591797 10)"><text x="32.25597381591797" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Receiver</text></g><g stroke-linecap="round" transform="translate(381.40246570622986 151.60516624169531) rotate(0 83.85032214759786 48.6463662859768)"><path d="M24.32 0 C54.22 1.9, 78.69 0.49, 143.38 0 M24.32 0 C60.07 -1.16, 94.3 -1.21, 143.38 0 M143.38 0 C159.24 1.93, 165.97 7.77, 167.7 24.32 M143.38 0 C158.01 -1.15, 168.56 9.17, 167.7 24.32 M167.7 24.32 C168.81 41.1, 166.26 56.43, 167.7 72.97 M167.7 24.32 C168.06 35.8, 168.79 48.95, 167.7 72.97 M167.7 72.97 C167.66 89.37, 158.79 97.06, 143.38 97.29 M167.7 72.97 C167.39 89.06, 160.9 99.43, 143.38 97.29 M143.38 97.29 C100.55 97.69, 62.06 97.96, 24.32 97.29 M143.38 97.29 C104.94 96, 65.93 96.34, 24.32 97.29 M24.32 97.29 C8 96.27, 1.67 88.33, 0 72.97 M24.32 97.29 C7.13 95.65, 0.27 87.04, 0 72.97 M0 72.97 C0.17 54.91, 2.26 40.83, 0 24.32 M0 72.97 C-0.76 62.16, -1.1 49.49, 0 24.32 M0 24.32 C1.22 8.36, 8.19 0.01, 24.32 0 M0 24.32 C0.19 9.56, 6.28 -0.32, 24.32 0" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(437.62080695783163 190.2515325276721) rotate(0 27.631980895996094 10)"><text x="27.631980895996094" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Handler</text></g><g stroke-linecap="round" transform="translate(894.1405891123219 149.86217151644155) rotate(0 83.85032214759786 48.6463662859768)"><path d="M24.32 0 C66.97 0.07, 110.36 -0.72, 143.38 0 M24.32 0 C62.95 -0.29, 101.2 0.36, 143.38 0 M143.38 0 C160.04 1.94, 169.34 9.29, 167.7 24.32 M143.38 0 C161.22 1.71, 166.47 6.83, 167.7 24.32 M167.7 24.32 C168.86 40.85, 169.66 53.99, 167.7 72.97 M167.7 24.32 C167.15 42.86, 167.08 60.57, 167.7 72.97 M167.7 72.97 C168.88 88.08, 160.34 95.83, 143.38 97.29 M167.7 72.97 C166.07 90.5, 158.59 96.77, 143.38 97.29 M143.38 97.29 C108.41 96.58, 76.5 97.59, 24.32 97.29 M143.38 97.29 C108.33 97.98, 71.92 97.37, 24.32 97.29 M24.32 97.29 C9.03 97.15, 0.53 89.45, 0 72.97 M24.32 97.29 C9.06 95.15, -1.32 89.03, 0 72.97 M0 72.97 C-1.17 65.02, -0.63 54.28, 0 24.32 M0 72.97 C-0.01 59.01, -0.4 44.12, 0 24.32 M0 24.32 C-1.42 9.84, 9.24 -0.85, 24.32 0 M0 24.32 C1.53 9.7, 8.15 1.3, 24.32 0" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(935.966947331697 188.50853780241835) rotate(0 42.023963928222656 10)"><text x="42.023963928222656" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Dispatcher</text></g><g stroke-linecap="round" transform="translate(10 29.51091381420349) rotate(0 76.69753666978187 57.74249180275939)"><path d="M96.25 14.5 C104.48 20.68, 117.1 29.84, 134.15 43.5 M96.25 14.5 C103.88 20.86, 111.89 26.06, 134.15 43.5 M134.15 43.5 C152.38 58.8, 152.73 56.52, 134.15 72.5 M134.15 43.5 C151.84 58.16, 154.16 56.92, 134.15 72.5 M134.15 72.5 C120.83 81.84, 112.4 91.09, 96.25 100.98 M134.15 72.5 C120.18 82.54, 106.82 93.26, 96.25 100.98 M96.25 100.98 C78.24 115.18, 75.27 116.08, 57.75 100.98 M96.25 100.98 C77.9 113.66, 79.15 114.75, 57.75 100.98 M57.75 100.98 C46.17 95.18, 37.93 86.81, 19.25 72.5 M57.75 100.98 C47.84 93.53, 40.07 86.33, 19.25 72.5 M19.25 72.5 C1.78 59.01, 0.75 57.83, 19.25 43.5 M19.25 72.5 C-1.7 59.38, 0.85 59.01, 19.25 43.5 M19.25 43.5 C30.67 34.84, 39.44 27.39, 57.75 14.5 M19.25 43.5 C32.48 32.38, 45.58 22.85, 57.75 14.5 M57.75 14.5 C76.37 -0.2, 75.82 -0.84, 96.25 14.5 M57.75 14.5 C78.03 -0.53, 75.95 -1.14, 96.25 14.5" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(53.8327923827425 67.38215971558316) rotate(0 33.01597595214844 20)"><text x="33.01597595214844" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">External</text><text x="33.01597595214844" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">event</text></g><g stroke-linecap="round"><g transform="translate(112.9852608068935 123.2705663620801) rotate(0 21.947587406497867 37.85783222513771)"><path d="M0.35 0 C1.22 9.82, -2.52 45.36, 4.53 57.95 C11.59 70.54, 36.02 72.51, 42.69 75.55 M-0.93 -1.04 C-0.09 8.5, -3.68 43.18, 3.97 56.15 C11.61 69.12, 38.09 73.19, 44.96 76.76" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(112.9852608068935 123.2705663620801) rotate(0 21.947587406497867 37.85783222513771)"><path d="M22.91 77.18 C28.3 78.23, 34.71 74.93, 44.96 76.76 M22.91 77.18 C29.34 77.54, 35.38 76.27, 44.96 76.76" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(112.9852608068935 123.2705663620801) rotate(0 21.947587406497867 37.85783222513771)"><path d="M27.79 62.91 C31.88 67.46, 37.1 67.64, 44.96 76.76 M27.79 62.91 C32.92 67.32, 37.59 70.08, 44.96 76.76" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask></mask><g stroke-linecap="round"><g transform="translate(336.56358999540635 201.60753668570237) rotate(0 19.266968350664925 -0.5567354459547005)"><path d="M0.02 0.31 C6.56 -0.02, 32.62 -1.15, 39.16 -1.42 M-0.63 -0.01 C5.87 -0.04, 32.27 -0.72, 38.89 -0.85" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(336.56358999540635 201.60753668570237) rotate(0 19.266968350664925 -0.5567354459547005)"><path d="M20.79 6.21 C26.5 4.75, 30.71 2.89, 38.89 -0.85 M20.79 6.21 C26.24 4.42, 30.52 2.88, 38.89 -0.85" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(336.56358999540635 201.60753668570237) rotate(0 19.266968350664925 -0.5567354459547005)"><path d="M20.49 -7.08 C26.35 -4.72, 30.65 -2.76, 38.89 -0.85 M20.49 -7.08 C25.99 -5.24, 30.35 -3.15, 38.89 -0.85" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask></mask><g stroke-linecap="round" transform="translate(625.7830542839494 148.34006074677222) rotate(0 56.70562500990002 51.43694262723545)"><path d="M58.38 -0.87 C67.64 -1.44, 79.08 2.64, 87.01 7.22 C94.94 11.8, 101.46 19.12, 105.97 26.63 C110.48 34.15, 114.12 43.65, 114.08 52.31 C114.03 60.97, 110.74 71.23, 105.71 78.61 C100.68 85.99, 92.45 92.49, 83.9 96.58 C75.36 100.66, 63.94 103.27, 54.42 103.13 C44.91 103, 34.72 100.22, 26.82 95.76 C18.92 91.3, 11.5 83.98, 7.03 76.37 C2.56 68.75, -0.3 58.59, -0.01 50.06 C0.28 41.54, 3.99 32.41, 8.78 25.21 C13.58 18.02, 20.07 11.01, 28.77 6.91 C37.48 2.81, 55.55 1.51, 61.01 0.62 C66.48 -0.27, 61.9 0.64, 61.57 1.56 M46.21 0.2 C54.77 -2, 65.5 -0.83, 74.58 2.16 C83.67 5.15, 94.36 11.44, 100.73 18.17 C107.1 24.9, 111.27 34.22, 112.79 42.54 C114.31 50.86, 113.17 59.88, 109.83 68.1 C106.5 76.31, 100.03 86.06, 92.78 91.85 C85.53 97.64, 75.66 101.54, 66.34 102.84 C57.02 104.13, 45.84 102.42, 36.86 99.63 C27.87 96.83, 18.59 92.66, 12.45 86.08 C6.31 79.5, 1.66 68.71, 0 60.14 C-1.66 51.56, -0.87 42.57, 2.48 34.65 C5.83 26.73, 12.75 18.19, 20.09 12.62 C27.42 7.04, 42.17 3.14, 46.51 1.19 C50.84 -0.76, 45.89 0.23, 46.11 0.92" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(650.071770511287 179.90559243878613) rotate(0 32.319976806640625 20)"><text x="32.319976806640625" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Incident</text><text x="32.319976806640625" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">DO</text></g><g stroke-linecap="round"><g transform="translate(555.1031100014256 200.2241748382694) rotate(0 32.578059518795925 -0.848532647173954)"><path d="M-0.78 0.36 C9.79 0.37, 52.92 0.19, 63.72 -0.09 M1.02 -0.5 C11.92 -0.85, 55.61 -2.06, 65.93 -2.06" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(555.1031100014256 200.2241748382694) rotate(0 32.578059518795925 -0.848532647173954)"><path d="M42.58 6.88 C50.84 2.51, 58.4 0.1, 65.93 -2.06 M42.58 6.88 C47.03 5.59, 52.23 1.91, 65.93 -2.06" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(555.1031100014256 200.2241748382694) rotate(0 32.578059518795925 -0.848532647173954)"><path d="M42.3 -10.22 C50.63 -8.99, 58.28 -5.8, 65.93 -2.06 M42.3 -10.22 C46.66 -7.69, 51.92 -7.55, 65.93 -2.06" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask></mask><g stroke-linecap="round" transform="translate(702.5826852101183 139.53139701580017) rotate(0 73.2139568912263 70)"><path d="M92.5 17.75 C102.75 25.48, 109.43 37.39, 127.93 53.25 M92.5 17.75 C102.73 28.73, 115.38 41.51, 127.93 53.25 M127.93 53.25 C146.04 72.45, 144.45 69.93, 127.93 88.75 M127.93 53.25 C147.01 71.6, 147.1 69.1, 127.93 88.75 M127.93 88.75 C117.57 99.16, 104.39 108.43, 92.5 122.25 M127.93 88.75 C115.37 100.96, 101.48 112.66, 92.5 122.25 M92.5 122.25 C75.65 138.97, 73.42 139.33, 55.5 122.25 M92.5 122.25 C72.08 140.14, 73.62 141.79, 55.5 122.25 M55.5 122.25 C46.53 112.86, 36.92 102.48, 18.5 88.75 M55.5 122.25 C40.31 109.99, 26.78 96.07, 18.5 88.75 M18.5 88.75 C0.88 70.21, -1.9 69.65, 18.5 53.25 M18.5 88.75 C-1.01 70.87, 2.05 69.19, 18.5 53.25 M18.5 53.25 C31.46 41.78, 45.16 28.99, 55.5 17.75 M18.5 53.25 C31.37 40.75, 45.7 27.6, 55.5 17.75 M55.5 17.75 C72.13 0.95, 75.77 1.68, 92.5 17.75 M55.5 17.75 C75.96 -1.92, 75.26 1.13, 92.5 17.75" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(746.9376952719423 179.53139701580017) rotate(0 28.751968383789062 30)"><text x="28.751968383789062" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Alarm</text><text x="28.751968383789062" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">/</text><text x="28.751968383789062" y="54.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Outbox</text></g><g stroke-linecap="round"><g transform="translate(843.9615739494067 212.21013250232818) rotate(0 22.14171172692886 -5.839970791317853)"><path d="M0.29 0.34 C7.66 -1.73, 37.14 -9.89, 44.5 -12.02 M-0.22 0.04 C7.08 -1.97, 36.82 -9.28, 44.24 -11.3" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(843.9615739494067 212.21013250232818) rotate(0 22.14171172692886 -5.839970791317853)"><path d="M25.35 1.65 C32.57 -2.37, 38.67 -6.99, 44.24 -11.3 M25.35 1.65 C29.88 -0.81, 33.51 -3.83, 44.24 -11.3" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(843.9615739494067 212.21013250232818) rotate(0 22.14171172692886 -5.839970791317853)"><path d="M21.45 -13.52 C30.09 -12.21, 37.57 -11.49, 44.24 -11.3 M21.45 -13.52 C26.91 -12.5, 31.44 -12.06, 44.24 -11.3" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask></mask><g stroke-linecap="round" transform="translate(1111.7651515301513 147.25747750715936) rotate(0 83.85032214759792 48.6463662859768)"><path d="M24.32 0 C70.74 -1.13, 115.02 1.6, 143.38 0 M24.32 0 C57.82 0.49, 92.9 0.88, 143.38 0 M143.38 0 C159.22 1.53, 168.09 8.38, 167.7 24.32 M143.38 0 C160.73 1, 168.24 10.17, 167.7 24.32 M167.7 24.32 C167.79 39.55, 168.26 55.64, 167.7 72.97 M167.7 24.32 C167.55 41.95, 167.34 61.61, 167.7 72.97 M167.7 72.97 C168.48 90.99, 158.49 96.4, 143.38 97.29 M167.7 72.97 C166.27 89.61, 159.54 96.57, 143.38 97.29 M143.38 97.29 C113.98 99.34, 84.33 97.57, 24.32 97.29 M143.38 97.29 C99.03 96.49, 54.53 95.53, 24.32 97.29 M24.32 97.29 C7.7 96.36, 1.77 90.57, 0 72.97 M24.32 97.29 C9.76 95.62, -0.56 87.9, 0 72.97 M0 72.97 C-1.77 59.5, 1.05 42.11, 0 24.32 M0 72.97 C-0.87 54.43, -0.43 36.81, 0 24.32 M0 24.32 C-0.57 7.27, 10.1 0.22, 24.32 0 M0 24.32 C-0.11 7.55, 8.27 -0.91, 24.32 0" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(1169.7034863730619 185.90384379313616) rotate(0 25.9119873046875 10)"><text x="25.9119873046875" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Sender</text></g><g stroke-linecap="round"><g transform="translate(1067.8412334075176 198.15455435468357) rotate(0 22.689716450512606 -1.3739983426514755)"><path d="M-0.19 0.48 C7.47 -0.07, 37.92 -2.62, 45.57 -3.23 M0.72 0.25 C8.37 -0.26, 37.83 -2.27, 45.29 -2.78" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(1067.8412334075176 198.15455435468357) rotate(0 22.689716450512606 -1.3739983426514755)"><path d="M24.57 6.41 C30.15 4.91, 33.11 3, 45.29 -2.78 M24.57 6.41 C29 4.02, 33.8 2.77, 45.29 -2.78" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(1067.8412334075176 198.15455435468357) rotate(0 22.689716450512606 -1.3739983426514755)"><path d="M23.51 -9.06 C29.34 -7.04, 32.54 -5.44, 45.29 -2.78 M23.51 -9.06 C28.22 -8.07, 33.25 -5.95, 45.29 -2.78" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask></mask><g stroke-linecap="round" transform="translate(1243.9390265875718 10) rotate(0 76.69753666978181 57.74249180275939)"><path d="M96.25 14.5 C108.94 22.53, 120.28 31.94, 134.15 43.5 M96.25 14.5 C103.73 20.28, 112.29 26.81, 134.15 43.5 M134.15 43.5 C152.43 57.38, 154.92 56.12, 134.15 72.5 M134.15 43.5 C155.34 57.21, 152.9 57.36, 134.15 72.5 M134.15 72.5 C118.17 83.81, 107.56 94.48, 96.25 100.98 M134.15 72.5 C125.01 80.86, 114.27 87.95, 96.25 100.98 M96.25 100.98 C77.3 116.16, 77.74 116.4, 57.75 100.98 M96.25 100.98 C76.02 115.46, 77.72 114.85, 57.75 100.98 M57.75 100.98 C50.27 96.18, 41.99 88.98, 19.25 72.5 M57.75 100.98 C48.98 93.67, 39.94 86.51, 19.25 72.5 M19.25 72.5 C1.28 58.32, -1.48 57.59, 19.25 43.5 M19.25 72.5 C-2.24 59.64, 1.49 59.38, 19.25 43.5 M19.25 43.5 C27.93 36.78, 40.54 26.34, 57.75 14.5 M19.25 43.5 C30.87 34.47, 41.91 26.61, 57.75 14.5 M57.75 14.5 C75.96 -0.71, 75.87 1.24, 96.25 14.5 M57.75 14.5 C78.33 1.27, 75.65 0.93, 96.25 14.5" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(1287.7718189703141 47.871245901379666) rotate(0 33.01597595214844 20)"><text x="33.01597595214844" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">External</text><text x="33.01597595214844" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">event</text></g><g stroke-linecap="round"><g transform="translate(1285.4657958253474 195.69551504207027) rotate(0 41.314604846504494 -45.11364855084116)"><path d="M0.08 0.77 C13.08 0.38, 65.16 13.59, 78.17 -2.21 C91.18 -18, 78.28 -78.44, 78.14 -93.98 M-1.34 0.13 C11.58 -0.63, 64.67 11.97, 77.77 -4.01 C90.87 -20, 77.38 -80.71, 77.26 -95.8" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(1285.4657958253474 195.69551504207027) rotate(0 41.314604846504494 -45.11364855084116)"><path d="M88.38 -73.41 C86.18 -78.62, 82.44 -87.68, 77.26 -95.8 M88.38 -73.41 C83.78 -81.61, 79.09 -89.84, 77.26 -95.8" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(1285.4657958253474 195.69551504207027) rotate(0 41.314604846504494 -45.11364855084116)"><path d="M71.39 -71.5 C74.47 -77.32, 76.01 -86.97, 77.26 -95.8 M71.39 -71.5 C73.31 -80.37, 75.12 -89.33, 77.26 -95.8" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask></mask></svg>

Each stage is decoupled

1. **Receivers** -> validate + normalize input
2. **The handler** -> pushes events to the DO
3. **DO** -> commits state + events atomically and schedules dispatch
3. **The dispatcher** -> delivers events
5. **Senders** -> produce side-effects

Adapters isolate integrations:

```
src/adapters/<name>/receiver/
src/adapters/<name>/sender/
```

Adding a new integration means adding an adapter, not touching core logic.

### Current adapters

**Dashboard** (`src/adapters/dashboard/`)
- Receiver: REST API
- Sender: writes to D1

**Slack** (`src/adapters/slack/`)
- Receiver: events, interactions
- Sender: messages, threads, channels

**Status page** (`src/dispatcher/status-page.ts`)
- Sender-only: persists affections to external DB

Each adapter handles idempotency in its own way.

## The AI agent

Each incident runs an agent that watches the timeline and generates suggestions.

It helps:
- resolve the incident
- keep stakeholders informed

The agent runs asynchronously. \
It reads from the timeline and writes back into it.

It is more inspired by Codex than by a classic tool-calling loop: each turn is a `IncidentAgentTurnWorkflow` run.

<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 351.4273428697751 298.96879970742384" width="350" height="300"><!-- svg-source:excalidraw --><metadata></metadata><defs><style class="style-fonts">
      @font-face { font-family: Excalifont; src: url(data:font/woff2;base64,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); }</style></defs><g stroke-linecap="round" transform="translate(36.902450646776174 10) rotate(0 56.70562500990002 51.43694262723545)"><path d="M58.38 -0.87 C67.64 -1.44, 79.08 2.64, 87.01 7.22 C94.94 11.8, 101.46 19.12, 105.97 26.63 C110.48 34.15, 114.12 43.65, 114.08 52.31 C114.03 60.97, 110.74 71.23, 105.71 78.61 C100.68 85.99, 92.45 92.49, 83.9 96.58 C75.36 100.66, 63.94 103.27, 54.42 103.13 C44.91 103, 34.72 100.22, 26.82 95.76 C18.92 91.3, 11.5 83.98, 7.03 76.37 C2.56 68.75, -0.3 58.59, -0.01 50.06 C0.28 41.54, 3.99 32.41, 8.78 25.21 C13.58 18.02, 20.07 11.01, 28.77 6.91 C37.48 2.81, 55.55 1.51, 61.01 0.62 C66.48 -0.27, 61.9 0.64, 61.57 1.56 M46.21 0.2 C54.77 -2, 65.5 -0.83, 74.58 2.16 C83.67 5.15, 94.36 11.44, 100.73 18.17 C107.1 24.9, 111.27 34.22, 112.79 42.54 C114.31 50.86, 113.17 59.88, 109.83 68.1 C106.5 76.31, 100.03 86.06, 92.78 91.85 C85.53 97.64, 75.66 101.54, 66.34 102.84 C57.02 104.13, 45.84 102.42, 36.86 99.63 C27.87 96.83, 18.59 92.66, 12.45 86.08 C6.31 79.5, 1.66 68.71, 0 60.14 C-1.66 51.56, -0.87 42.57, 2.48 34.65 C5.83 26.73, 12.75 18.19, 20.09 12.62 C27.42 7.04, 42.17 3.14, 46.51 1.19 C50.84 -0.76, 45.89 0.23, 46.11 0.92" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(61.191166874113776 41.565531692013906) rotate(0 32.319976806640625 20)"><text x="32.319976806640625" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Incident</text><text x="32.319976806640625" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">DO</text></g><g stroke-linecap="round" transform="translate(37.35060109881613 153.8432062621739) rotate(0 55.9812318572458 50)"><path d="M70 12.75 C73.88 19.77, 80.57 22.48, 97.96 38.25 M70 12.75 C79.08 21.24, 88.48 29.61, 97.96 38.25 M97.96 38.25 C113.11 50.06, 112.45 52.95, 97.96 63.75 M97.96 38.25 C113.22 49.81, 109.91 49.27, 97.96 63.75 M97.96 63.75 C92.36 70.17, 84.25 74.67, 70 87.25 M97.96 63.75 C88.58 71.4, 79.69 77.5, 70 87.25 M70 87.25 C56.21 98.78, 55.98 99.21, 42 87.25 M70 87.25 C55.51 101.22, 56.43 102, 42 87.25 M42 87.25 C34.26 81.57, 23.43 74.18, 14 63.75 M42 87.25 C32.89 80.87, 23.56 72.28, 14 63.75 M14 63.75 C0.49 50.04, 0.37 49.18, 14 38.25 M14 63.75 C-1.99 48.81, 1.99 48.92, 14 38.25 M14 38.25 C25.53 29.23, 34.1 19.97, 42 12.75 M14 38.25 C24.3 27.87, 36.2 16.9, 42 12.75 M42 12.75 C56.06 0.37, 57.02 1.96, 70 12.75 M42 12.75 C56.57 0.13, 54.01 -0.99, 70 12.75" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(70.56523130966559 183.8432062621739) rotate(0 22.775985717773438 20)"><text x="22.775985717773438" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Agent</text><text x="22.775985717773438" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Turn</text></g><g mask="url(#mask-lXzHJnE9jnLDWONfnbsxh)" stroke-linecap="round"><g transform="translate(85.77759684667245 118.42428343238714) rotate(0 -23.046871052275463 30.725795668351537)"><path d="M-0.2 -0.15 C-7.95 4.84, -42 20.46, -45.54 30.7 C-49.07 40.93, -25.48 56.38, -21.41 61.25 M-1.76 -1.28 C-9.21 3.76, -40.3 21.01, -43.18 31.68 C-46.06 42.34, -22.69 57.93, -19.04 62.73" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(85.77759684667245 118.42428343238714) rotate(0 -23.046871052275463 30.725795668351537)"><path d="M-36.59 55.37 C-30.08 57.14, -24.83 59.45, -19.04 62.73 M-36.59 55.37 C-31.38 57.67, -25.83 59.74, -19.04 62.73" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(85.77759684667245 118.42428343238714) rotate(0 -23.046871052275463 30.725795668351537)"><path d="M-27.76 45.81 C-24.56 51.22, -22.68 57.17, -19.04 62.73 M-27.76 45.81 C-25.49 51.15, -22.81 56.34, -19.04 62.73" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask id="mask-lXzHJnE9jnLDWONfnbsxh"><rect x="0" y="0" fill="#fff" width="230.64321401805194" height="279.35723599333176"></rect><rect x="10" y="140.17992713028434" fill="#000" width="61.82395935058594" height="20" opacity="1"></rect></mask><g transform="translate(10 140.17992713028434) rotate(0 52.73072579439699 8.970151970454339)"><text x="30.91197967529297" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">context</text></g><g mask="url(#mask-V713An0IWjJcGrTz0NQWs)" stroke-linecap="round"><g transform="translate(143.77603096812834 204.7236098249084) rotate(0 22.621192628828624 -53.2260117935773)"><path d="M-0.23 0.14 C7.61 -8.75, 47.89 -34.95, 47.63 -52.74 C47.36 -70.53, 6.52 -97.59, -1.83 -106.59 M-1.82 -0.83 C5.92 -10.08, 47.4 -36.84, 47.31 -54.28 C47.21 -71.71, 5.88 -96.84, -2.39 -105.44" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(143.77603096812834 204.7236098249084) rotate(0 22.621192628828624 -53.2260117935773)"><path d="M21.28 -97.38 C13.25 -98.24, 6.66 -102.38, -2.39 -105.44 M21.28 -97.38 C14.28 -100.48, 8.78 -100.91, -2.39 -105.44" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(143.77603096812834 204.7236098249084) rotate(0 22.621192628828624 -53.2260117935773)"><path d="M10.56 -84.06 C6.2 -89.53, 3.33 -98.3, -2.39 -105.44 M10.56 -84.06 C6.53 -90.76, 3.96 -94.84, -2.39 -105.44" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask id="mask-V713An0IWjJcGrTz0NQWs"><rect x="0" y="0" fill="#fff" width="292.4267971830136" height="411.00357511958464"></rect><rect x="143.60637203564295" y="140.86100828870542" fill="#000" width="93.21591186523438" height="20" opacity="1"></rect></mask><g transform="translate(143.60637203564295 140.86100828870542) rotate(0 22.790851561314014 10.636589742625688)"><text x="46.60795593261719" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Suggestions</text></g><g stroke-linecap="round" transform="translate(225.5733581852213 196.05152301386727) rotate(0 35.522801640550824 31.600086113614054)"><path d="M33.74 -0.82 C40.21 -1.5, 49.64 1.51, 55.48 4.94 C61.33 8.38, 66.44 14.04, 68.79 19.77 C71.15 25.5, 71.42 33.02, 69.61 39.3 C67.79 45.57, 63.5 53.57, 57.91 57.42 C52.32 61.27, 43.01 62.39, 36.08 62.41 C29.14 62.43, 22.01 61.05, 16.3 57.56 C10.58 54.07, 4.35 47.14, 1.78 41.46 C-0.78 35.78, -1.04 29.25, 0.91 23.47 C2.85 17.69, 6.95 10.68, 13.46 6.8 C19.96 2.91, 34.6 0.94, 39.93 0.17 C45.26 -0.61, 45.36 1.49, 45.45 2.13 M41.44 0.38 C48.25 0.67, 55.1 3.71, 59.82 7.71 C64.54 11.7, 68.57 18.13, 69.74 24.33 C70.91 30.53, 69.64 39.06, 66.86 44.9 C64.08 50.75, 58.88 56.25, 53.08 59.4 C47.29 62.55, 39.18 64.78, 32.09 63.79 C25 62.79, 15.91 57.82, 10.54 53.43 C5.17 49.04, 0.83 43.55, -0.11 37.44 C-1.06 31.33, 1.87 22.25, 4.87 16.78 C7.87 11.31, 11.89 7.45, 17.89 4.62 C23.89 1.8, 37.29 0.6, 40.88 -0.17 C44.46 -0.93, 39.69 -0.43, 39.41 0.02" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g stroke-linecap="round" transform="translate(248.61313798326012 196.36346858260993) rotate(0 35.522801640550824 31.600086113614054)"><path d="M29.02 -0.03 C35.25 -1.79, 43.68 -0.7, 50 2.12 C56.32 4.94, 63.43 11.2, 66.95 16.87 C70.47 22.54, 72.17 30.12, 71.14 36.14 C70.11 42.17, 65.65 48.58, 60.77 53.01 C55.88 57.44, 48.62 61.48, 41.83 62.74 C35.03 64, 26.28 63.14, 19.99 60.57 C13.7 57.99, 7.38 52.7, 4.09 47.29 C0.8 41.88, -0.71 34.51, 0.23 28.12 C1.17 21.72, 3.61 13.58, 9.74 8.9 C15.87 4.23, 31.34 1.36, 37.01 0.08 C42.68 -1.19, 43.88 0.79, 43.74 1.24 M51.39 4.64 C57.38 7.21, 62.93 12.38, 66.23 17.53 C69.53 22.68, 71.87 29.56, 71.18 35.54 C70.49 41.52, 66.94 48.84, 62.07 53.41 C57.21 57.97, 48.98 61.76, 42.01 62.94 C35.04 64.12, 26.39 63.37, 20.24 60.51 C14.09 57.65, 8.28 51.5, 5.12 45.76 C1.96 40.02, 0.61 32.21, 1.3 26.09 C2 19.97, 4.3 13.16, 9.29 9.06 C14.28 4.97, 24.41 2.28, 31.24 1.51 C38.06 0.74, 47.01 4.12, 50.25 4.43 C53.49 4.74, 50.91 3.24, 50.69 3.36" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g stroke-linecap="round" transform="translate(270.38173958867344 197.30450438164962) rotate(0 35.522801640550824 31.600086113614054)"><path d="M39.07 0.32 C45.79 0.51, 53.97 4.18, 59.15 8.28 C64.32 12.39, 68.75 19.08, 70.13 24.95 C71.5 30.81, 70.3 37.75, 67.39 43.47 C64.48 49.19, 58.4 55.99, 52.65 59.26 C46.9 62.54, 39.6 63.89, 32.89 63.11 C26.17 62.33, 17.72 58.61, 12.37 54.59 C7.02 50.56, 2.43 44.83, 0.79 38.93 C-0.84 33.04, -0.37 25.02, 2.57 19.21 C5.5 13.41, 11.64 7.17, 18.38 4.1 C25.13 1.02, 38.65 0.99, 43.03 0.77 C47.41 0.55, 44.94 2.17, 44.65 2.8 M48.48 1.74 C54.71 3.43, 61.77 9.48, 65.68 14.79 C69.6 20.09, 72.42 27.63, 71.98 33.57 C71.54 39.5, 67.37 45.72, 63.03 50.42 C58.7 55.11, 52.54 59.81, 45.96 61.74 C39.39 63.68, 30.31 63.95, 23.6 62.03 C16.9 60.1, 9.62 55.56, 5.74 50.18 C1.86 44.79, 0.13 36.11, 0.34 29.73 C0.55 23.35, 2.8 16.66, 6.98 11.89 C11.17 7.11, 18.81 2.54, 25.45 1.08 C32.08 -0.38, 43.01 2.75, 46.78 3.14 C50.56 3.52, 47.85 3.1, 48.09 3.38" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g mask="url(#mask-oogalCza_kFiL6OrzEZMX)" stroke-linecap="round"><g transform="translate(124.82533766702238 224.96367814348355) rotate(0 47.68285403574569 21.899667030066894)"><path d="M1.18 0.31 C6.61 7.67, 17.28 42.23, 32.92 43.21 C48.56 44.2, 84.76 12.38, 95.02 6.2 M0.34 -0.58 C5.62 7, 16.51 42.99, 32.17 44.34 C47.83 45.68, 83.92 13.69, 94.31 7.5" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(124.82533766702238 224.96367814348355) rotate(0 47.68285403574569 21.899667030066894)"><path d="M80.33 28.24 C85.58 21.92, 88.33 14.67, 94.31 7.5 M80.33 28.24 C84.61 21.5, 88.21 16.25, 94.31 7.5" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(124.82533766702238 224.96367814348355) rotate(0 47.68285403574569 21.899667030066894)"><path d="M70.28 14.41 C78.71 12.52, 84.75 9.8, 94.31 7.5 M70.28 14.41 C77.5 11.8, 84.1 10.68, 94.31 7.5" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask id="mask-oogalCza_kFiL6OrzEZMX"><rect x="0" y="0" fill="#fff" width="319.7567340235777" height="368.96879970742384"></rect><rect x="94.79290390787935" y="248.96879970742384" fill="#000" width="125.16790771484375" height="40" opacity="1"></rect></mask><g transform="translate(94.79290390787935 248.96879970742384) rotate(0 77.71528779488872 -2.1054545338733988)"><text x="62.583953857421875" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Context </text><text x="62.583953857421875" y="34.096000000000004" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Provider Agents</text></g><g mask="url(#mask--9UNWT-Fi8vzKmb8sr0fJ)" stroke-linecap="round"><g transform="translate(285.33337941136574 197.12172420724505) rotate(0 -64.59168726166234 -66.88132948333731)"><path d="M0.82 0.72 C-1.53 -14.24, 7.86 -68.08, -13.96 -90.62 C-35.77 -113.15, -110.78 -127.39, -130.07 -134.48 M-0.21 0.05 C-2.64 -15.19, 6.9 -70.11, -14.35 -92.4 C-35.6 -114.69, -108.47 -127.11, -127.71 -133.69" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(285.33337941136574 197.12172420724505) rotate(0 -64.59168726166234 -66.88132948333731)"><path d="M-102.81 -135.99 C-109.42 -133.35, -117.3 -136.06, -127.71 -133.69 M-102.81 -135.99 C-107.77 -134.81, -113.81 -134.66, -127.71 -133.69" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g><g transform="translate(285.33337941136574 197.12172420724505) rotate(0 -64.59168726166234 -66.88132948333731)"><path d="M-107.16 -119.45 C-112.29 -122.01, -118.82 -129.89, -127.71 -133.69 M-107.16 -119.45 C-111.09 -121.85, -116.19 -125.27, -127.71 -133.69" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g></g><mask id="mask--9UNWT-Fi8vzKmb8sr0fJ"><rect x="0" y="0" fill="#fff" width="514.3996217049221" height="430.59343421895005"></rect><rect x="237.719185552132" y="95.8524618119767" fill="#000" width="65.21592712402344" height="20" opacity="1"></rect></mask><g transform="translate(237.719185552132 95.8524618119767) rotate(0 -16.977493402428593 34.387932911931046)"><text x="32.60796356201172" y="14.096" font-family="Excalifont, Xiaolai, sans-serif, Segoe UI Emoji" font-size="16px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Insights</text></g></svg>

### Debouncing

Not every event should trigger a turn.
- First turn: delayed 60s (let the incident stabilize)
- Subsequent turns: 13s debounce window

### Execution

Each turn:

1. Fetch snapshot (state + events)
2. Call LLM with tools
3. Optionally trigger context agents
4. Persist suggestions as events
5. Post to Slack

Suggestions are stored as internal events, so future turns have memory and avoid repetition.

## Context agents

Context agents are separate Durable Objects that run background investigations.

That keeps the incident DO focused on coordination, not research.

They are decoupled to:
- run asynchronously
- avoid polluting the main incident context

### Base agent

Context agents extend `AgentBase`, which provides:

- **SQLite storage** -> (`steps`, `contexts`)
- **Summarization** -> keeps token usage bounded
- **Alarm-driven execution**
- **Lazy initialization**

### Bidirectional RPC

The incident DO and context agents communicate in both directions:

**-> provider**:
- `addContext`: pushes new timeline events for background processing
- `addPrompt`: handles user questions from Slack, pulling the provider's latest findings

**Provider ->**:
- `getAgentContext`: pulls the full incident snapshot to inform investigation
- `recordAgentInsightEvent`: writes insight events (`SIMILAR_INCIDENT`, `GITHUB_COMMIT`) without `published_at`, so they flow through the normal alarm/dispatch cycle and trigger new agent turns

### Current providers

- **`SimilarIncidentsAgent`** -> searches past incidents for similar patterns.
- **`GitHubCommitsAgent`** -> surfaces relevant commits

Future ones:
- AWS investigator (via CLI, on Container-enabled Durable Objects)
- DataDog (via MCP)

## Prompt workflow

Users can directly ask the agent questions. Handled by `IncidentPromptWorkflow`:

1. LLM decides what to do
2. If needed, calls context agents
3. Executes action or responds

A :fire: reaction shows progress.

Expected usage is command-like ("resolve incident", "post status page update"), making it easy for untrained responders.

## Reliability

Everything optimizes for one goal:
> never lose an event

- Acknowledgement happens after persistence
- State + event are atomic
- Delivery is retried
- Senders are isolated

So far: ** 0 lost events**, with low double-digit millisecond latency.

## Folder structure

```
- Adapters: src/adapters/*
- Handler: src/handler
- Core DO: src/core/incident.ts
- Alarm: src/core/incident/alarm.ts
- Dispatcher: src/dispatcher/workflow.ts
- Agents: src/agent/providers/
```

---

The only part I’m still unsure about is how context agents will interact as their number grows.

We’ll find out.
