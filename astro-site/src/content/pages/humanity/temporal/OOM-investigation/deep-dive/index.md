# OOM investigation > Enrich deep dive

A sequel to the [conversation worker OOM](../): same class of problem, no single-line fix.

After fixing the conversation worker, I expected the enrich worker to be boring. It wasn't crashing as dramatically, but it had the same smell: memory climbed with cached workflows and the bundle was much larger than it should have been.

The difference was that this time the problem didn't collapse into `"sideEffects": false`. Instead, it turned into a bundle experiment log.

I started a [thread in the Temporal Slack](https://temporalio.slack.com/archives/C01DKSMU94L/p1772534214550679) while working through this.

## Why We Started Looking

The previous incident taught us something important: **for Temporal TypeScript workers, the workflow bundle is not just a build artifact. It is part of the runtime memory model.** \
So after that fix, I looked at our other Temporal service, which acts as a background jobs runner for many types of workflows: enrich.

The numbers were suspicious:

| Service      | Bundle size | Cached WFs |
|:------------:|:-----------:|:----------:|
| conversation | ~2.93 MiB   | ~700       |
| enrich       | ~14.1 MiB   | ~150       |

That immediately put the bundle under suspicion.

The top contributors in the enrich bundle were:

- `zod@4` at ~1 MB
- `ai@6` at ~435 KB
- workflow tool definitions at ~350 KB
- `@enginy/common` at ~300 KB
- workflow utils at ~227 KB
- `tldts` at ~150 KB
- a huge hardcoded `isPersonalEmail` domain set at ~126 KB
- Prisma browser runtime
- HTML parsing dependencies

## The First Hypothesis

The obvious theory: each cached workflow gets its own copy of too much code, so bundle size is directly drives RSS.

That fit the observed failure shape. Workers would start, the sticky cache would fill, and memory would rise with it.

## Bundle Inspection

The first pass was static analysis. I looked at the built workflow bundle and the import graph, then traced the biggest paths back to source.

### syncQueue pulled in far too much

`syncQueue.ts` imported multiple CRM adapters directly. Those adapters brought in `tldts`, HTML parsing packages, string similarity helpers, `isPersonalEmail`, and the Prisma browser runtime.

The workflow wasn’t just orchestrating activities anymore. It was pulling a large chunk of adapter logic into workflow code.

### AI workflows pulled ai + zod into the bundle

Some workflows intentionally use the AI SDK in-workflow. That is a real requirement, but it means the bundle includes `ai`, `zod`, lots of tool definitions, and large prompt/schema-related code. Legitimate, but expensive.

## Can We Fix It Without Touching Workflow Code?

Before refactoring any workflow logic, I wanted to see how much we could get just by changing how the bundle is produced.

### Aggressive Webpack Optimization

The first temptation: just optimize harder. `minimize: true`, custom Terser config, changing source map mode, more aggressive webpack optimization flags, externalizing modules.

This is where Temporal becomes opinionated.

Temporal workflow bundling is not a generic webpack build. It is part of the workflow sandbox. If you change too much, you can break workflow type names, stack traces, source maps, replay/debugging expectations, and possibly bundler assumptions used by the reusable VM executor.

In particular, `minimize: true` is unsafe unless function names are preserved, and replacing Temporal's source map configuration is risky. \
This is due to how workflows are resolved by name.

**Result:** Promising in theory, not safe enough as a default production fix. I did not want to solve an OOM by introducing a determinism or workflow registration problem.

### ignoreModules / Externalization

If some heavy packages should only exist at activity runtime, maybe we can tell the bundler to ignore them.

This works only if the workflow bundle does not actually need those modules at evaluation time. That turned out to be the key limitation: if a workflow directly imports code that imports `tldts`, you cannot simply ignore `tldts`. If `syncQueue` directly imports CRM adapter code, those adapter dependencies are part of the workflow module graph. If AI workflows use `ai` and `zod` inside workflow code, those packages cannot be externalized away.

**Result:** Useful only for modules that should not have been in workflow code in the first place. Not a general solution.

### Strip sourcesContent From Inline Source Maps

Temporal wants inline source maps, and changing source map behavior broadly is risky. But stripping `sourcesContent` while keeping line/column mappings intact is a narrower change: you still get pointers to the original file/line, but the full embedded source text is removed from the bundle.

This reduced ~150 MB of base memory and I haven't noticed any difference in practice - sourcemap pointers still work, so errors show the same file and line information.

A smaller win compared to what could be achieved, but it was the cleanest no-refactor change.

**Result:** ~150 MB base memory reduction with no visible downsides.

## Understanding What Temporal Actually Reuses

This was the eureka moment.

I patched the Temporal runtime locally to log what landed in the shared module cache vs the workflow-specific module cache.

The behavior is roughly:

- The workflow bundle wrapper is loaded once in the reusable VM
- Temporal SDK internals and a small set of known-safe modules are reused
- **User workflow modules are evaluated into module objects per workflow cache entry**
- **External libraries imported by user workflow code are generally treated as workflow-specific as well**

What gets reused is not “all imported libraries.” It’s mainly the shared VM context, the bundle scaffold, and Temporal runtime internals. \
Reusing those blindly could be problematic. If a module has mutable top-level state: a counter, a cache, a configuration object... sharing it across workflows would mean one workflow's execution could silently affect another's. The SDK can't know which modules are safe to share, so it defaults to giving each cached workflow its own copy of everything.

That explained everything. The bundle exists once, but **most of its modules do not**. A small workflow that only needs to verify an email was getting its own in-memory copy of the AI SDK, `zod`, all the CRM adapter code, the `isPersonalEmail` domain set, and everything else in the bundle - just because the workflow barrel imported everything eagerly.

## Lazy Workflow Loading

Once that was clear, the goal became: stop every workflow from eagerly importing every other workflow's dependency tree.

### First attempt: rewriting the bundle

The first idea was to rewrite the workflow entry file to only export the workflows each type actually needs. But mapping workflow type names back to their source files is error prone, and rewriting the bundle seems too hacky, so I decided against it.

### Second attempt: lazy imports

Next I tried dynamic `import()` to lazy-load heavy workflows on demand. This didn't work well either: dynamic imports caused webpack to split the bundle, which breaks Temporal's expectation of a single self-contained bundle file.

### What worked: require()

The solution was using `require()` instead of `import()`. Since the bundle is already a single file evaluated in a V8 context, `require()` resolves within the bundle without triggering code splitting.

This meant the workflow entry file had to be a CommonJS file (`.cjs`), but that was a small price. The entry file maps workflow type names to `require()` calls, so each workflow only loads its own dependency tree when it's actually needed.

I decided to try this with the workflows that are most run, as reducing their memory footprint means reducing it for most of the cached workflows.

The best candidates for lazy loading were workflows with large and distinct dependency trees: `syncQueue`, AI fill workflows and workflow runners that pull many other workflows transitively.

```javascript
const lazyWorkflows = {
  syncQueue: [() => require('./workflows/syncQueue'), 'syncQueue'],
  fillAiFieldsWorkflow: [() => require('./workflows/fillAiFieldsWorkflowV2'), 'fillAiFieldsWorkflow'],
  ...
}

const getWorkflowExport = (workflowType) => {
  if (workflowType === 'default' || workflowType === '__esModule') {
    return undefined
  }

  const lazyWorkflow = lazyWorkflows[workflowType]
  if (lazyWorkflow) {
    const [loadModuleFn, exportName] = lazyWorkflow
    const workflowModule = loadModuleFn()
    return workflowModule[exportName]
  }

  return require('./workflows/index')[workflowType]
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      return typeof prop === 'string' ? getWorkflowExport(prop) : undefined
    },
  },
)
```

When I inspected module-cache counts for specific workflows after the change, targeted workflows loaded far fewer modules than the fallback path.

| Workflow                  | Workflow-specific modules |
|:-------------------------:|:-------------------------:|
| syncQueue                 | ~27                       |
| verifyLeadEmailWorkflow   | ~19                       |
| enrichLeadWorkflow        | ~22                       |
| Fallback (eager path)     | ~280                      |

Lazy workflow registration doesn’t make workflow code shared, but it drastically reduces how much code each workflow pulls into its module cache. \
That was the real win.

Next steps will be to lazy load all workflows, though I prefer keeping it simple so other developers don't have to understand all of this, and can keep using the simple: `export * from myWorkflow`

## The Result

<figure style="margin: 2rem 0;">
  <img
    src="/humanity/temporal/workflow-bundle/enrich/enrich-memory-utilization.png"
    alt="enrich ECS memory utilization dropping from ~63% to ~35% after deployment"
    style="max-width: 100%;"
  />
  <figcaption style="text-align: center; font-style: italic; margin-top: 0.5rem; color: #666;">
    Max memory utilization
  </figcaption>
</figure>

Memory utilization max dropped from ~100% with 150 cached workflows (can be seen at ~65% with ~100) to ~35% after the deployment, also with 150 cached workflows.

<figure style="margin: 2rem 0;">
  <img
    src="/humanity/temporal/workflow-bundle/enrich/enrich-sticky-cache-size.png"
    alt="enrich sticky cache size recovering from ~90 to ~150 cached workflows"
    style="max-width: 100%;"
  />
  <figcaption style="text-align: center; font-style: italic; margin-top: 0.5rem; color: #666;">
    Max cached workflows
  </figcaption>
</figure>

We ended up with a layered fix:

1. Strip `sourcesContent` from the enrich workflow bundle's inline source maps (not a major win, but a safe starting point)
2. Introduce lazy workflow loading via a `.cjs` entry file using `require()` for the most common workflows
3. Trim barrel exports so the fallback path is less expensive

These changes improved behavior without updating workflow code, so transparent to other developers.

## What Temporal can improve

Two things would make this class of problem much easier to solve:

**User module opt-in freezing.** If a module is known to be stateless (e.g. `zod`, `ai`, utility libraries), the SDK could allow users to mark it as safe to reuse across cached workflows instead of evaluating it into each workflow's module cache. An opt-in freeze list would let the shared VM context actually share the expensive modules, which is what most users expect `reuseV8Context` to do.

**Better support for per-workflow bundle splitting.** The lazy `require()` approach works, but it's a workaround. First-class support for registering workflows with separate bundles (or bundle segments) would let teams isolate heavy dependency trees without the `.cjs` entry file hack. The underlying mechanism already seems to work; making it an officially supported pattern would make this much easier to reason about.
